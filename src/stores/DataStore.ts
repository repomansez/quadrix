import { autoSubscribeWithKey, AutoSubscribeStore, StoreBase } from 'resub';
import { RoomSummary } from '../models/RoomSummary';
import { User } from '../models/User';
import ApiClient from '../matrix/ApiClient';
import EventUtils from '../utils/EventUtils';
import {
	CallEventContent_,
	CallMemberEventContent_,
	ClientEvent_,
	MemberEventContent_,
	MessageEventContent_,
	PowerLevelEventContent_,
	PresenceEventContent_,
	RoomData_,
	RoomEventContent_,
	RoomPhase,
	RoomSummary_,
	RoomTimeline_,
	RoomType,
	SyncResponse_,
	ToDeviceEvent_,
} from '../models/MatrixApi';
import { FilteredChatEvent } from '../models/FilteredChatEvent';
import * as _ from 'lodash';
import { ReadReceipt } from '../models/ReadReceipt';

interface RoomEventTriggers {
	isNewMessageEvent?: boolean;
	isNewMemberEvent?: boolean;
	isNewRoomNameEvent?: boolean;
	isNewRoomAvatarEvent?: boolean;
	isNewRoomAliasEvent?: boolean;
	isNewJoinRuleEvent?: boolean;
	isNewPowerLevelEvent?: boolean;
	isNewActiveStatus?: boolean;
	isNewReadReceipt?: boolean;
	isNewUnreadCount?: boolean;
	isNewRoom?: boolean;
	isNewRoomPhase?: boolean;
	isNewRoomType?: boolean;
	isNewUserPresence?: boolean;
	isNewCallEvent?: boolean;
}

const ReadReceiptTrigger = 'ReadReceiptTrigger';
const MessageTrigger = 'MessageTrigger';
const RoomTypeTrigger = 'RoomTypeTrigger';
const RoomPhaseTrigger = 'RoomPhaseTrigger';
const RoomActiveTrigger = 'RoomActiveTrigger';
const SyncCompleteTrigger = 'SyncCompleteTrigger';
const RoomListTrigger = 'RoomListTrigger';
const UnreadTotalTrigger = 'UnreadTotalTrigger';
const RoomSummaryTrigger = 'RoomSummaryTrigger';
const UserPresenceTrigger = 'UserPresenceTrigger';
const ToDeviceCallEventTrigger = 'ToDeviceCallEventTrigger';

@AutoSubscribeStore
class DataStore extends StoreBase {
	// must use an array here, no object, based on:
	// https://github.com/Microsoft/ReSub/issues/12
	// otherwise no re-render in RoomList
	private roomSummaryList: RoomSummary[] = [];
	private directRoomList: { [id: string]: string } = {};
	private lastSeenTime: { [id: string]: number } = {};
	private syncComplete = false;
	private toDeviceCallEvents: ToDeviceEvent_[] = [];

	public ReadReceiptTrigger = ReadReceiptTrigger;
	public MessageTrigger = MessageTrigger;
	public RoomTypeTrigger = RoomTypeTrigger;
	public RoomPhaseTrigger = RoomPhaseTrigger;
	public RoomActiveTrigger = RoomActiveTrigger;
	public SyncCompleteTrigger = SyncCompleteTrigger;
	public RoomListTrigger = RoomListTrigger;
	public UnreadTotalTrigger = UnreadTotalTrigger;
	public RoomSummaryTrigger = RoomSummaryTrigger;
	public UserPresenceTrigger = UserPresenceTrigger;
	public ToDeviceCallEventTrigger = ToDeviceCallEventTrigger;

	public buildRoomSummaryList(syncData: SyncResponse_) {
		this.roomSummaryList = [];

		this.setDirectRoomList(syncData);
		this.setRoomSummaryList(syncData);
	}

	private setDirectRoomList(syncData: SyncResponse_) {
		if (!syncData.account_data) {
			return;
		}

		const directIndex = syncData.account_data.events.findIndex(event => event.type === 'm.direct');

		if (directIndex > -1) {
			const content = syncData.account_data.events[directIndex].content;

			for (const contactId in content) {
				content[contactId].map((roomId: string) => {
					this.directRoomList[roomId] = contactId;
				});
			}
		}
	}

	private setRoomSummaryList(syncData: SyncResponse_) {
		if (!syncData.rooms) {
			this.setSyncComplete(true);
			return;
		}

		for (const roomId in syncData.rooms.invite) {
			const roomSummary: RoomSummary = {
				id: roomId,
				phase: 'invite',
				members: {},
				timelineEvents: [],
				stateEvents: [],
				unreadCount: 1,
				active: false,
				readReceipts: {},
				newEvents: [],
			};

			this.roomSummaryList.push(roomSummary);

			this.setRoomSummary(syncData.rooms.invite[roomId], roomId, 'invite');
		}

		for (const roomId in syncData.rooms.join) {
			const roomSummary: RoomSummary = {
				id: roomId,
				phase: 'join',
				members: {},
				timelineEvents: [],
				stateEvents: [],
				unreadCount: 0,
				readReceipts: {},
				newEvents: [],
			};

			this.roomSummaryList.push(roomSummary);

			this.setRoomSummary(syncData.rooms.join[roomId], roomId, 'join');
		}

		this.trigger(RoomListTrigger);
	}

	private setRoomSummary(roomObj: RoomData_, roomId: string, phase: RoomPhase) {
		const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

		if (phase === 'join') {
			this.setRoomInfoFromEvents(roomObj.state.events, roomIndex);
			this.updateState(roomObj.state.events, roomIndex);
		} else if (phase === 'invite') {
			this.setRoomInfoFromEvents(roomObj.invite_state.events, roomIndex);
		}

		this.setRoomInfoFromSummary(roomObj.summary, roomIndex);

		this.setRoomType(roomId, roomIndex);

		if (this.roomSummaryList[roomIndex].type === 'direct') {
			this.setContactId(roomIndex);
		}

		if (this.roomSummaryList[roomIndex].type === 'community' && !this.roomSummaryList[roomIndex].name) {
			this.roomSummaryList[roomIndex].name = this.roomSummaryList[roomIndex].alias;
		}

		if (phase === 'join') {
			this.setRoomActive(roomIndex);
		}
	}

	private setRoomInfoFromEvents(events: ClientEvent_[], roomIndex: number): RoomEventTriggers {
		if (!events || events.length === 0) {
			return {};
		}

		const roomEventTriggers: RoomEventTriggers = {};
		events.map(event => {
			const content = event.content;
			switch (event.type) {
				case 'm.room.message':
					roomEventTriggers.isNewMessageEvent = true;
					if (this.roomSummaryList[roomIndex].type !== 'community') {
						roomEventTriggers.isNewUserPresence = this.setPresenceFromEvent(event);
					}
					break;

				case 'm.room.member':
					if (this.roomSummaryList[roomIndex].type !== 'community') {
						roomEventTriggers.isNewMemberEvent = true;
						roomEventTriggers.isNewUserPresence = this.setPresenceFromEvent(event);
					}
					this.setRoomMember(event, roomIndex);
					break;

				case 'm.room.redaction':
					roomEventTriggers.isNewMessageEvent = true;
					break;

				case 'org.matrix.msc3401.call':
					roomEventTriggers.isNewCallEvent = true;
					this.roomSummaryList[roomIndex].msc3401Call = {
						callId: event.state_key!,
						startTime: event.origin_server_ts,
						callEventContent: content as CallEventContent_,
						participants: {},
					};
					break;

				case 'org.matrix.msc3401.call.member':
					if (this.roomSummaryList[roomIndex].msc3401Call) {
						roomEventTriggers.isNewCallEvent = true;
						if (
							(<CallMemberEventContent_>content)['m.calls'][0] &&
							(<CallMemberEventContent_>content)['m.calls'][0]['m.call_id'] ===
								this.roomSummaryList[roomIndex].msc3401Call?.callId
						) {
							this.roomSummaryList[roomIndex].msc3401Call!.participants![event.state_key!] = true;
						} else {
							this.roomSummaryList[roomIndex].msc3401Call!.participants![event.state_key!] = false;
						}
					}
					break;

				case 'm.room.name':
					roomEventTriggers.isNewRoomNameEvent = true;
					this.roomSummaryList[roomIndex].name = (<RoomEventContent_>content).name;
					break;

				case 'm.room.avatar':
					roomEventTriggers.isNewRoomAvatarEvent = true;
					this.roomSummaryList[roomIndex].avatarUrl = (<RoomEventContent_>content).url;
					break;

				case 'm.room.canonical_alias':
					roomEventTriggers.isNewRoomAliasEvent = true;
					this.roomSummaryList[roomIndex].alias = (<RoomEventContent_>content).alias;
					break;

				case 'm.room.join_rules':
					roomEventTriggers.isNewJoinRuleEvent = true;
					this.roomSummaryList[roomIndex].joinRule = (<RoomEventContent_>content).join_rule;
					break;

				case 'm.room.power_levels':
					roomEventTriggers.isNewPowerLevelEvent = true;
					this.setUserPowerLevel(event, roomIndex);
					this.setMsc3401Ready(event, roomIndex);
					break;

				case 'm.room.topic':
					this.roomSummaryList[roomIndex].topic = (<RoomEventContent_>content).topic;
					break;

				case 'm.room.third_party_invite':
					roomEventTriggers.isNewMemberEvent = true;
					this.roomSummaryList[roomIndex].thirdPartyInviteId = (<MemberEventContent_>content).display_name;
					break;

				case 'm.room.create':
					if (
						content &&
						// bubblegum & wires hack
						// @ts-ignore
						((<RoomEventContent_>content)._is_notepad || // TODO: remove
							// @ts-ignore
							(<RoomEventContent_>content).is_notepad || // TODO: remove
							(<RoomEventContent_>content)['chat.quadrix.notepad'])
					) {
						this.roomSummaryList[roomIndex].type = 'notepad';
						this.roomSummaryList[roomIndex].active = true;
						roomEventTriggers.isNewRoomType = true;
					}
					break;
			}
		});

		return roomEventTriggers;
	}

	private setUserPowerLevel(event: ClientEvent_, roomIndex: number) {
		const content = event.content as RoomEventContent_;
		if (!content.users) {
			return;
		}
		Object.keys(content.users).map(user => {
			const member: User = {
				id: user,
				powerLevel: content.users![user],
				membership: content.users![user] === 100 ? 'join' : undefined,
			};

			this.roomSummaryList[roomIndex].members[user] = {
				...this.roomSummaryList[roomIndex].members[user],
				...member,
			};
		});
	}

	private setMsc3401Ready(event: ClientEvent_, roomIndex: number) {
		const content = event.content as PowerLevelEventContent_;
		if (!content.events) {
			return;
		}
		const msc3401Call = content.events?.['org.matrix.msc3401.call'];

		if (msc3401Call !== undefined) {
			this.roomSummaryList[roomIndex].msc3401Ready = true;
		}
	}

	private setRoomMember(event: ClientEvent_, roomIndex: number) {
		const content = event.content as MemberEventContent_;
		const member: User = {
			id: event.state_key!,
			name: content.displayname!,
			avatarUrl: content.avatar_url!,
			membership: content.membership,
			...(content.is_direct && { isDirect: true }),
		};

		// TODO: doesn't powerlevel get lost here?
		this.roomSummaryList[roomIndex].members[member.id] = {
			...this.roomSummaryList[roomIndex].members[member.id],
			...member,
		};

		// in case a 3rd party invite has been accepted, need to reset contactid
		// is this the right place?
		if (this.roomSummaryList[roomIndex].thirdPartyInviteId && content.third_party_signed) {
			this.setContactId(roomIndex);
			this.roomSummaryList[roomIndex].thirdPartyInviteId = undefined;
		}
	}

	private setRoomInfoFromSummary(summary: RoomSummary_, roomIndex: number) {
		if (!summary) {
			return;
		}

		summary['m.joined_member_count']
			? (this.roomSummaryList[roomIndex].joinMembersCount = summary['m.joined_member_count'])
			: 0;
		summary['m.invited_member_count']
			? (this.roomSummaryList[roomIndex].inviteMembersCount = summary['m.invited_member_count'])
			: 0;
		summary['m.heroes'] ? (this.roomSummaryList[roomIndex].heroes = summary['m.heroes']) : null;
	}

	private setRoomType(roomId: string, roomIndex: number) {
		if (this.roomSummaryList[roomIndex].type) {
			return;
		}

		if (this.directRoomList[roomId]) {
			this.roomSummaryList[roomIndex].type = 'direct';
		} else if (this.roomSummaryList[roomIndex].joinRule === 'public') {
			this.roomSummaryList[roomIndex].type = 'community';
		} else if (this.roomSummaryList[roomIndex].name) {
			this.roomSummaryList[roomIndex].type = 'group';
		} else {
			this.roomSummaryList[roomIndex].type = 'direct';
		}
	}

	private trySetRoomType(roomId: string, roomIndex: number) {
		if (this.roomSummaryList[roomIndex].type) {
			return;
		}

		if (this.directRoomList[roomId]) {
			this.roomSummaryList[roomIndex].type = 'direct';
		} else if (this.roomSummaryList[roomIndex].joinRule === 'public') {
			this.roomSummaryList[roomIndex].type = 'community';
		} else if (this.roomSummaryList[roomIndex].name) {
			this.roomSummaryList[roomIndex].type = 'group';
		} else {
			for (const userId in this.roomSummaryList[roomIndex].members) {
				if (this.roomSummaryList[roomIndex].members[userId].isDirect) {
					this.roomSummaryList[roomIndex].type = 'direct';
					break;
				}
			}
		}
	}

	private setContactId(roomIndex: number) {
		if (this.directRoomList[this.roomSummaryList[roomIndex].id]) {
			this.roomSummaryList[roomIndex].contactId = this.directRoomList[this.roomSummaryList[roomIndex].id];
		} else if (Object.keys(this.roomSummaryList[roomIndex].members).length > 1) {
			for (const memberId in this.roomSummaryList[roomIndex].members) {
				if (memberId !== ApiClient.credentials.userIdFull) {
					this.roomSummaryList[roomIndex].contactId = memberId;
					break;
				}
			}
		} else if (this.roomSummaryList[roomIndex].heroes && this.roomSummaryList[roomIndex].heroes!.length > 0) {
			this.roomSummaryList[roomIndex].contactId = this.roomSummaryList[roomIndex].heroes![0];
		} else if (this.roomSummaryList[roomIndex].thirdPartyInviteId) {
			this.roomSummaryList[roomIndex].contactId = this.roomSummaryList[roomIndex].thirdPartyInviteId!;
		} else {
			this.roomSummaryList[roomIndex].contactId = 'unknown';
		}
	}

	private setRoomActive(roomIndex: number): boolean {
		const active = this.roomSummaryList[roomIndex].active;

		if (this.roomSummaryList[roomIndex].type === 'community') {
			this.roomSummaryList[roomIndex].active = true;
		} else if (this.roomSummaryList[roomIndex].type === 'direct') {
			const contactId = this.roomSummaryList[roomIndex].contactId;

			this.roomSummaryList[roomIndex].active =
				this.roomSummaryList[roomIndex].members[contactId!] &&
				this.roomSummaryList[roomIndex].members[contactId!].membership === 'join';
		} else if (this.roomSummaryList[roomIndex].type === 'notepad') {
			this.roomSummaryList[roomIndex].active = true;
		} else {
			this.roomSummaryList[roomIndex].active = this.roomSummaryList[roomIndex].joinMembersCount! > 1;
		}

		return active !== this.roomSummaryList[roomIndex].active;
	}

	private updateTimeLine(timeline: RoomTimeline_, roomIndex: number) {
		if (!timeline?.events || timeline?.events.length === 0) {
			return;
		}

		/*
        HACK: when timeline is "limited", the batch token normally starts with the letter "t" (presumably for "to")
        but when accepting an invitation to a room with few events,
        the first timeline sync returns "limited", and a batch token starting with "s" (presumably for "start")
        the room has obviously no older events, so why is it "limited"?
        is this a bug? feature? documentation has no info on this
        so this case has to be managed by checking for a batch token starting with "s" in the below condition
        and the corresponding timeline must be set to "not limited"
        */

		if (timeline.limited && timeline.prev_batch.slice(0, 1) !== 's') {
			this.roomSummaryList[roomIndex].timelineEvents = timeline.events;
			this.roomSummaryList[roomIndex].timelineToken = timeline.prev_batch;
			this.roomSummaryList[roomIndex].timelineLimited = true;
		} else {
			this.roomSummaryList[roomIndex].timelineEvents = this.roomSummaryList[roomIndex].timelineEvents.concat(
				timeline.events
			);
		}
	}

	private updateState(events: ClientEvent_[], roomIndex: number) {
		if (!events || events.length === 0) {
			return;
		}
		this.roomSummaryList[roomIndex].stateEvents = this.roomSummaryList[roomIndex].stateEvents.concat(events);
	}

	private updateNewEvents(timeline: RoomTimeline_, roomIndex: number) {
		if (!timeline?.events || timeline.events?.length === 0) {
			return;
		}

		const newEvents = EventUtils.filterRoomEvents(
			timeline.events.slice(0).reverse(),
			this.roomSummaryList[roomIndex].type!
		);
		this.roomSummaryList[roomIndex].newEvents = newEvents;
		this.roomSummaryList[roomIndex].newEventsLimited = timeline.limited;
	}

	private updateLatestFilteredEvent(roomIndex: number) {
		if (
			!this.roomSummaryList[roomIndex].timelineEvents ||
			this.roomSummaryList[roomIndex].timelineEvents.length === 0
		) {
			return;
		}

		const redactedEventIds: string[] = [];
		for (let i = this.roomSummaryList[roomIndex].timelineEvents.length; i > 0; i--) {
			const event = this.roomSummaryList[roomIndex].timelineEvents[i - 1];
			const isFilteredEvent = EventUtils.filterEvent(event, this.roomSummaryList[roomIndex].type!);
			if (isFilteredEvent && event.type === 'm.room.redaction') {
				if (event.redacts) {
					redactedEventIds.push(event.redacts);
				}
			} else if (isFilteredEvent && event.type !== 'm.room.redaction') {
				const content = event.content as MessageEventContent_;
				this.roomSummaryList[roomIndex].latestFilteredEvent = {
					eventId: event.event_id,
					content: event.content,
					type: event.type,
					time: event.origin_server_ts,
					senderId: event.sender,
					previousContent: event.unsigned ? event.unsigned.prev_content : undefined,
					stateKey: event.state_key,
					isRedacted:
						redactedEventIds.includes(event.event_id) ||
						(content['m.relates_to']?.rel_type === 'm.replace'
							? redactedEventIds.includes(content['m.relates_to'].event_id!)
							: false) ||
						(['m.room.message'].includes(event.type) && Object.keys(event.content).length === 0),
					isEdited: Boolean(event.unsigned?.['m.relations']?.['m.replace']),
				};
				break;
			}
		}
	}

	// comes from sync
	public updateUserPresence(syncData: SyncResponse_) {
		if (!syncData.presence) {
			return;
		}

		let isNewPresence = false;

		const time = Date.now();

		syncData.presence.events.map(event => {
			if (event.type === 'm.presence' && event.content) {
				const content = event.content as PresenceEventContent_;
				this.lastSeenTime[event.sender] = Math.max(
					this.lastSeenTime[event.sender] || 0,
					time - content.last_active_ago!
				);
				isNewPresence = true;
			}
		});

		if (isNewPresence) {
			this.trigger(UserPresenceTrigger);
		}
	}

	public handleToDevice(syncData: SyncResponse_) {
		if (!syncData.to_device) {
			return;
		}

		syncData.to_device.events.map(event => {
			switch (event.type) {
				case 'm.call.invite':
					this.toDeviceCallEvents.push(event);
					break;

				case 'm.call.candidates':
					this.toDeviceCallEvents.push(event);
					break;

				case 'm.call.answer':
					this.toDeviceCallEvents.push(event);
					break;

				case 'm.call.select_answer':
					this.toDeviceCallEvents.push(event);
					break;

				case 'org.matrix.call.sdp_stream_metadata_changed':
					this.toDeviceCallEvents.push(event);
					break;

				case 'm.call.negotiate':
					this.toDeviceCallEvents.push(event);
					break;

				case 'm.call.hangup':
					this.toDeviceCallEvents.push(event);
					break;

				default:
					break;
			}
		});

		this.trigger(ToDeviceCallEventTrigger);
	}

	public updateRoomSummaryListInitial(syncData: SyncResponse_) {
		if (!syncData.rooms) {
			return;
		}

		for (const roomId in syncData.rooms.join) {
			const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

			if (roomIndex > -1 && this.roomSummaryList[roomIndex].phase === 'join') {
				this.updateTimeLine(syncData.rooms.join[roomId].timeline, roomIndex);
				this.updateState(syncData.rooms.join[roomId].state.events, roomIndex);

				this.updateLatestFilteredEvent(roomIndex);

				if (this.roomSummaryList[roomIndex].type !== 'community') {
					this.updateReadReceipts(syncData.rooms.join[roomId], roomIndex);
					this.setPresenceFromTimeline(roomIndex);
					this.updateUnreadCount(syncData.rooms.join[roomId], roomIndex);
				}
			}
		}

		this.setSyncComplete(true);
	}

	private updateJoinRoom(roomObj: RoomData_, roomIndex: number): RoomEventTriggers {
		this.updateTimeLine(roomObj.timeline, roomIndex);
		this.updateState(roomObj.state.events, roomIndex);
		this.updateNewEvents(roomObj.timeline, roomIndex);
		if (roomObj.timeline?.events?.length > 0) {
			this.updateLatestFilteredEvent(roomIndex);
		}

		const roomEventTriggers1 = this.setRoomInfoFromEvents(roomObj.timeline?.events, roomIndex);

		const roomEventTriggers2 = this.setRoomInfoFromEvents(roomObj.state?.events, roomIndex);

		const roomEventTriggers = { ...roomEventTriggers1, ...roomEventTriggers2 };

		if (this.roomSummaryList[roomIndex].type !== 'community' && roomEventTriggers.isNewMemberEvent) {
			this.setRoomInfoFromSummary(roomObj.summary, roomIndex);
			roomEventTriggers.isNewActiveStatus = this.setRoomActive(roomIndex);
		}

		if (this.roomSummaryList[roomIndex].type !== 'community') {
			roomEventTriggers.isNewReadReceipt = this.updateReadReceipts(roomObj, roomIndex);
			roomEventTriggers.isNewUnreadCount = this.updateUnreadCount(roomObj, roomIndex);
		}

		return roomEventTriggers;
	}

	private updateNewJoinRoom(roomObj: RoomData_, roomIndex: number): RoomEventTriggers {
		const roomEventTriggers: RoomEventTriggers = {};

		this.setRoomInfoFromSummary(roomObj.summary, roomIndex);

		this.setRoomInfoFromEvents(roomObj.timeline?.events, roomIndex);

		this.trySetRoomType(this.roomSummaryList[roomIndex].id, roomIndex);

		this.updateTimeLine(roomObj.timeline, roomIndex);
		this.updateState(roomObj.state.events, roomIndex);

		this.updateNewEvents(roomObj.timeline, roomIndex);
		this.updateLatestFilteredEvent(roomIndex);

		if (this.roomSummaryList[roomIndex].type) {
			roomEventTriggers.isNewRoom = true;
			roomEventTriggers.isNewRoomType = true;

			if (this.roomSummaryList[roomIndex].type === 'direct') {
				this.setContactId(roomIndex);
			}

			roomEventTriggers.isNewActiveStatus = this.setRoomActive(roomIndex);
		}

		return roomEventTriggers;
	}

	private updateAcceptedInviteRoom(roomObj: RoomData_, roomIndex: number): RoomEventTriggers {
		this.updateTimeLine(roomObj.timeline, roomIndex);

		this.updateNewEvents(roomObj.timeline, roomIndex);
		this.updateLatestFilteredEvent(roomIndex);

		this.setRoomInfoFromSummary(roomObj.summary, roomIndex);

		const roomEventTriggers = this.setRoomInfoFromEvents(roomObj.timeline?.events, roomIndex);

		this.roomSummaryList[roomIndex].phase = 'join';
		this.roomSummaryList[roomIndex].unreadCount = 0;
		this.roomSummaryList[roomIndex].active = true;

		roomEventTriggers.isNewRoomPhase = true;
		roomEventTriggers.isNewActiveStatus = true;

		return roomEventTriggers;
	}

	private initialiseNewJoinRoom(roomObj: RoomData_, roomId: string): RoomEventTriggers {
		const roomEventTriggers: RoomEventTriggers = {};

		const roomSummary: RoomSummary = {
			id: roomId,
			phase: 'join',
			members: {},
			timelineEvents: [],
			stateEvents: [],
			unreadCount: 0,
			readReceipts: {},
			newEvents: [],
		};

		this.roomSummaryList.push(roomSummary);

		const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

		this.setRoomInfoFromSummary(roomObj.summary, roomIndex);

		this.setRoomInfoFromEvents(roomObj.state?.events, roomIndex);

		this.setRoomInfoFromEvents(roomObj.timeline?.events, roomIndex);

		this.trySetRoomType(roomId, roomIndex);

		this.updateTimeLine(roomObj.timeline, roomIndex);
		this.updateState(roomObj.state.events, roomIndex);

		this.updateNewEvents(roomObj.timeline, roomIndex);
		this.updateLatestFilteredEvent(roomIndex);

		if (this.roomSummaryList[roomIndex].type) {
			roomEventTriggers.isNewRoom = true;
			roomEventTriggers.isNewRoomType = true;

			if (this.roomSummaryList[roomIndex].type === 'direct') {
				this.setContactId(roomIndex);
			}

			roomEventTriggers.isNewActiveStatus = this.setRoomActive(roomIndex);
		}

		return roomEventTriggers;
	}

	private initialiseNewInviteRoom(roomObj: RoomData_, roomId: string): RoomEventTriggers {
		const roomEventTriggers: RoomEventTriggers = {};

		const roomSummary: RoomSummary = {
			id: roomId,
			phase: 'invite',
			members: {},
			timelineEvents: [],
			stateEvents: [],
			unreadCount: 1,
			readReceipts: {},
			newEvents: [],
		};

		this.roomSummaryList.push(roomSummary);

		this.setRoomSummary(roomObj, roomId, 'invite');

		roomEventTriggers.isNewRoom = true;

		return roomEventTriggers;
	}

	public updateRoomSummaryList(syncData: SyncResponse_) {
		if (!syncData.rooms) {
			if (!this.syncComplete) {
				this.setSyncComplete(true);
			}

			return;
		}

		let roomEventTriggers: RoomEventTriggers = {};

		for (const roomId in syncData.rooms.join) {
			const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

			if (
				roomIndex > -1 &&
				this.roomSummaryList[roomIndex].phase === 'join' &&
				this.roomSummaryList[roomIndex].type
			) {
				roomEventTriggers = this.updateJoinRoom(syncData.rooms.join[roomId], roomIndex);
			} else if (
				roomIndex > -1 &&
				this.roomSummaryList[roomIndex].phase === 'join' &&
				!this.roomSummaryList[roomIndex].type
			) {
				roomEventTriggers = this.updateNewJoinRoom(syncData.rooms.join[roomId], roomIndex);
			} else if (roomIndex > -1 && this.roomSummaryList[roomIndex].phase === 'invite') {
				roomEventTriggers = this.updateAcceptedInviteRoom(syncData.rooms.join[roomId], roomIndex);
			} else if (roomIndex === -1) {
				roomEventTriggers = this.initialiseNewJoinRoom(syncData.rooms.join[roomId], roomId);
			}
		}

		for (const roomId in syncData.rooms.invite) {
			const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

			if (roomIndex === -1) {
				roomEventTriggers = this.initialiseNewInviteRoom(syncData.rooms.invite[roomId], roomId);
			}
		}

		for (const roomId in syncData.rooms.leave) {
			const roomIndex = this.roomSummaryList.findIndex(roomSummary => roomSummary.id === roomId);

			if (roomIndex > -1) {
				this.roomSummaryList[roomIndex].phase = 'leave';

				roomEventTriggers.isNewRoomPhase = true;
			}
		}

		this.triggerSubscriptions(roomEventTriggers);
	}

	private triggerSubscriptions(roomEventTriggers: RoomEventTriggers) {
		if (roomEventTriggers.isNewReadReceipt) {
			this.trigger(ReadReceiptTrigger);
		}

		if (
			roomEventTriggers.isNewMessageEvent ||
			roomEventTriggers.isNewMemberEvent ||
			roomEventTriggers.isNewRoomNameEvent ||
			roomEventTriggers.isNewRoomAvatarEvent ||
			roomEventTriggers.isNewCallEvent
		) {
			this.trigger(MessageTrigger);
		}

		if (roomEventTriggers.isNewRoomType) {
			this.trigger(RoomTypeTrigger);
		}

		if (roomEventTriggers.isNewRoomPhase) {
			this.trigger(RoomPhaseTrigger);
		}

		if (roomEventTriggers.isNewActiveStatus) {
			this.trigger(RoomActiveTrigger);
		}

		if (
			roomEventTriggers.isNewMessageEvent ||
			roomEventTriggers.isNewRoom ||
			roomEventTriggers.isNewRoomPhase ||
			roomEventTriggers.isNewMemberEvent ||
			roomEventTriggers.isNewRoomNameEvent ||
			roomEventTriggers.isNewRoomAvatarEvent ||
			roomEventTriggers.isNewCallEvent
		) {
			this.trigger(RoomListTrigger);
		}

		if (roomEventTriggers.isNewUnreadCount) {
			this.trigger(RoomListTrigger);
			this.trigger(UnreadTotalTrigger);
			this.trigger(RoomSummaryTrigger);
		}

		if (
			roomEventTriggers.isNewRoomType ||
			roomEventTriggers.isNewRoomPhase ||
			roomEventTriggers.isNewRoom ||
			roomEventTriggers.isNewRoomAvatarEvent ||
			roomEventTriggers.isNewRoomNameEvent ||
			roomEventTriggers.isNewMemberEvent ||
			roomEventTriggers.isNewCallEvent
		) {
			this.trigger(RoomSummaryTrigger);
		}

		if (roomEventTriggers.isNewUserPresence || roomEventTriggers.isNewReadReceipt) {
			this.trigger(UserPresenceTrigger);
		}

		if (!this.syncComplete) {
			this.setSyncComplete(true);
		}
	}

	private updateUnreadCount(roomObj: RoomData_, roomIndex: number): boolean {
		if (!roomObj.unread_notifications) {
			return false;
		}

		const isNewUnreadCount =
			this.roomSummaryList[roomIndex].unreadCount !== roomObj.unread_notifications.notification_count;

		if (isNewUnreadCount) {
			this.roomSummaryList[roomIndex].unreadCount = roomObj.unread_notifications.notification_count;
		}

		return isNewUnreadCount;
	}

	private updateReadReceipts(roomObj: RoomData_, roomIndex: number): boolean {
		if (!roomObj.ephemeral?.events || roomObj.ephemeral?.events.length === 0) {
			return false;
		}

		const newReceipts: ReadReceipt = {};

		roomObj.ephemeral.events
			.filter(event => event.type === 'm.receipt')
			.map(event => {
				const content = event.content;
				for (const eventId in content) {
					for (const userId in content[eventId]['m.read']) {
						if (
							!this.roomSummaryList[roomIndex].members[userId] ||
							!this.roomSummaryList[roomIndex].members[userId].membership ||
							this.roomSummaryList[roomIndex].members[userId].membership === 'join'
						) {
							newReceipts[userId] = {
								eventId: eventId,
								timestamp: content[eventId]['m.read'][userId].ts,
							};

							// HACK: fake presence
							this.lastSeenTime[userId] = Math.max(
								this.lastSeenTime[userId] || 0,
								newReceipts[userId].timestamp
							);
						}
					}
				}
			});

		this.roomSummaryList[roomIndex].readReceipts = {
			...this.roomSummaryList[roomIndex].readReceipts,
			...newReceipts,
		};

		return Object.keys(newReceipts).length > 0;
	}

	// HACK: fake presence
	private setPresenceFromEvent(event: ClientEvent_): boolean {
		const userId = event.sender;
		const timestamp = event.origin_server_ts;
		const isNewPresence = timestamp > this.lastSeenTime[userId];

		this.lastSeenTime[userId] = Math.max(this.lastSeenTime[userId] || 0, timestamp);

		return isNewPresence;
	}

	// HACK: fake presence
	private setPresenceFromTimeline(roomIndex: number) {
		const senders: string[] = [];
		this.roomSummaryList[roomIndex].timelineEvents
			.slice(0)
			.reverse()
			.map(event => {
				if (!senders.includes(event.sender)) {
					senders.push(event.sender);

					this.setPresenceFromEvent(event);
				}
			});
	}

	public getTimelineLength(roomId: string): number {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].timelineEvents.length;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getTimelineToken(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].timelineToken;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getTimelineLimited(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].timelineLimited;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getNewEventsLimited(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].newEventsLimited;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getAllRoomEvents(roomId: string): FilteredChatEvent[] {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);

		return EventUtils.filterRoomEvents(
			this.roomSummaryList[roomIndex].timelineEvents.slice(0).reverse(),
			this.roomSummaryList[roomIndex].type!
		);
	}

	public getImageTimeline(roomId: string): { timeline: ClientEvent_[]; endToken: string } {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);

		const timeline = this.roomSummaryList[roomIndex].timelineEvents
			.filter(event => {
				const content = event.content as MessageEventContent_;
				return (
					event.type === 'm.room.message' &&
					content &&
					content.msgtype === 'm.image' &&
					!content.body?.toLowerCase().includes('.svg') &&
					content.url
				);
			})
			.sort((a, b) => b.origin_server_ts - a.origin_server_ts);

		return {
			timeline: timeline,
			endToken: this.roomSummaryList[roomIndex].timelineToken!,
		};
	}

	@autoSubscribeWithKey('DummyTrigger')
	public clearRoomSummaryList() {
		this.roomSummaryList = [];
		this.directRoomList = {};
		this.lastSeenTime = {};
		this.syncComplete = false;
	}

	// used in room
	@autoSubscribeWithKey(RoomPhaseTrigger)
	public getRoomPhase(roomId: string): RoomPhase | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return roomIndex > -1 ? this.roomSummaryList[roomIndex].phase : undefined;
	}

	// used in room
	@autoSubscribeWithKey(RoomTypeTrigger)
	public getRoomType(roomId: string): RoomType | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return roomIndex > -1 ? this.roomSummaryList[roomIndex].type : undefined;
	}

	// used in inviteroom
	public getInviteSender(roomId: string): User {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);

		let sender: User;
		for (const memberId in this.roomSummaryList[roomIndex].members) {
			if (memberId !== ApiClient.credentials.userIdFull) {
				sender = this.roomSummaryList[roomIndex].members[memberId];
				break;
			}
		}
		return sender!;
	}

	// used in roomheader
	@autoSubscribeWithKey(UnreadTotalTrigger)
	public getUnreadTotal(roomId: string) {
		let unreadTotal = 0;
		this.roomSummaryList
			.filter(roomSummary => roomSummary.id !== roomId)
			.map(roomSummary => {
				if (roomSummary.unreadCount === undefined) {
					return;
				}
				unreadTotal += roomSummary.unreadCount > 0 ? roomSummary.unreadCount : 0;
			});
		return unreadTotal;
	}

	// used in room
	@autoSubscribeWithKey(RoomActiveTrigger)
	public getRoomActive(roomId: string): boolean {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return roomIndex > -1 ? this.roomSummaryList[roomIndex].active! : false;
	}

	// used in roomtile and roomheader
	@autoSubscribeWithKey(RoomSummaryTrigger)
	public getRoomSummary(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex];
	}

	// used in roomchat
	@autoSubscribeWithKey(MessageTrigger)
	public getNewRoomEvents(roomId: string): FilteredChatEvent[] {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].newEvents;
	}

	public getLatestFilteredEvent(roomId: string): FilteredChatEvent | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].latestFilteredEvent;
	}

	// used in roomlist
	@autoSubscribeWithKey(RoomListTrigger)
	public getSortedRoomList(): Array<RoomSummary> {
		const sortedRoomList = this.roomSummaryList
			.filter(roomSummary => roomSummary && roomSummary.phase !== 'leave' && roomSummary.type)
			.sort(
				(a, b) =>
					a.phase.localeCompare(b.phase) ||
					b.unreadCount - a.unreadCount ||
					(b.latestFilteredEvent?.time || 0) - (a.latestFilteredEvent?.time || 0)
			);

		return sortedRoomList;
	}

	// used in userpresence
	@autoSubscribeWithKey(UserPresenceTrigger)
	public getLastSeenTime(userId: string): number {
		return this.lastSeenTime[userId] || 0;
	}

	public getLastSeenTime_(userId: string): number {
		return this.lastSeenTime[userId] || 0;
	}

	// TODO: eventually get rid of this, since stale readreceipts are now eliminated on sync
	private activeReadReceipts(roomIndex: number): ReadReceipt | undefined {
		const readReceipts = this.roomSummaryList[roomIndex].readReceipts;
		if (readReceipts) {
			for (const id in readReceipts) {
				if (this.roomSummaryList[roomIndex].members[id]?.membership !== 'join') {
					delete readReceipts[id];
				}
			}
		}
		return readReceipts;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public _getReadReceipts(roomId: string): ReadReceipt | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.activeReadReceipts(roomIndex);
	}

	public getReadReceipts(roomId: string): ReadReceipt | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.activeReadReceipts(roomIndex);
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getLastReadReceiptTimestamp(roomId: string, userId: string): number {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].readReceipts![userId]?.timestamp;
	}

	public getUsers(): User[] {
		const users: { [id: string]: User } = {};

		for (const roomSummary of this.roomSummaryList) {
			if (roomSummary.type !== 'community') {
				for (const member of Object.values(roomSummary.members)) {
					users[member.id] = {
						id: member.id,
						name: member.name || users[member.id]?.name || undefined,
						avatarUrl: member.avatarUrl || users[member.id]?.avatarUrl || undefined,
					};
				}
			}
		}

		return Object.values(users).filter(user => user.id && user.id !== ApiClient.credentials.userIdFull);
	}

	public getMemberName(roomId: string, userId: string): string {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].members[userId]?.name || userId;
	}

	public addMembers(roomId: string, members: { [id: string]: User }) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		this.roomSummaryList[roomIndex].members = members;
	}

	public getPowerLevel(roomId: string, userId: string): number {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].members[userId]?.powerLevel || 0;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getPowerLevel_(roomId: string, userId: string): number {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].members[userId]?.powerLevel || 0;
	}

	public setSyncComplete(isComplete: boolean) {
		this.syncComplete = isComplete;
		this.trigger(SyncCompleteTrigger);
	}

	// used in roomlist
	@autoSubscribeWithKey(SyncCompleteTrigger)
	public getSyncComplete(): boolean {
		return this.syncComplete;
	}

	public removeRoom(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		this.roomSummaryList.splice(roomIndex, 1);
	}

	public getTopic(roomId: string): string | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].topic;
	}

	public getAlias(roomId: string): string | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].alias;
	}

	public getRoomName(roomId: string): string | undefined {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);

		let roomName: string | undefined;
		if (this.roomSummaryList[roomIndex].type === 'direct') {
			roomName = this.roomSummaryList[roomIndex].members[this.roomSummaryList[roomIndex].contactId!]?.name;
		} else {
			roomName = this.roomSummaryList[roomIndex].name || this.roomSummaryList[roomIndex].alias;
		}

		return roomIndex > -1 ? roomName : '';
	}

	public getRoomSummaryList() {
		return this.roomSummaryList;
	}

	public getLastSeenTimeArray(): { [id: string]: number } {
		return this.lastSeenTime;
	}

	public setRoomSummaryListFromStorage(roomSummaryList: RoomSummary[]) {
		this.roomSummaryList = roomSummaryList;
	}

	public setLastSeenTimeFromStorage(lastSeenTime: { [id: string]: number }) {
		this.lastSeenTime = lastSeenTime;
	}

	// TODO: Cleanup this bubblegum and wires trigger mess
	@autoSubscribeWithKey('DummyTrigger')
	public getMsc3401Call(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].msc3401Call;
	}

	public getMsc3401Call_(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].msc3401Call;
	}

	@autoSubscribeWithKey(MessageTrigger)
	public getMsc3401Call__(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].msc3401Call;
	}

	@autoSubscribeWithKey('DummyTrigger')
	public getMsc3401Ready(roomId: string) {
		const roomIndex = this.roomSummaryList.findIndex((roomSummary: RoomSummary) => roomSummary.id === roomId);
		return this.roomSummaryList[roomIndex].msc3401Ready || false;
	}

	@autoSubscribeWithKey(ToDeviceCallEventTrigger)
	public getToDeviceCallEvents(): ToDeviceEvent_[] {
		const toDeviceCallEvents = _.cloneDeep(this.toDeviceCallEvents);

		this.toDeviceCallEvents = [];

		return toDeviceCallEvents;
	}
}

export default new DataStore();
