import React from 'react';
import RX from 'reactxp';
import DialogRoomPicker from '../../dialogs/DialogRoomPicker';
import DialogIncomingContentShare from '../../dialogs/DialogIncomingContentShare';
import { EmitterSubscription, Linking } from 'react-native';
import { sendTo } from '../../translations';
import UiStore from '../../stores/UiStore';
import { SharedContent } from '../../models/SharedContent';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { PermissionsAndroid, PermissionStatus } from 'react-native';
import { FilteredChatEvent } from '../../models/FilteredChatEvent';

class ShareHandlerIncoming {
	private linkingListener: EmitterSubscription | undefined;

	public launchedFromSharedContent(sharedContent: string, shareContent: (event: { url: string }) => void): void {
		if (sharedContent) {
			// android only, bug in RN Linking, need to use native code + initial prop
			// https://github.com/facebook/react-native/issues/25675#issuecomment-801879847

			shareContent({ url: sharedContent });
		}
	}

	public addListener(shareContent: (event: { url: string }) => void): void {
		this.linkingListener = Linking.addEventListener('url', shareContent);
	}

	public removeListener(): void {
		this.linkingListener?.remove();
	}

	private async requestReadStoragePermission(): Promise<boolean> {
		const granted: PermissionStatus = await PermissionsAndroid.request(
			PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
		).catch(_error => {
			return 'denied';
		});

		return granted === PermissionsAndroid.RESULTS.GRANTED;
	}

	public async shareContent(
		sharedContent_: string,
		showTempForwardedMessage: (roomId: string, message: FilteredChatEvent, tempId: string) => void
	): Promise<void> {
		const sharedContent = JSON.parse(sharedContent_) as SharedContent;

		RX.Modal.dismissAll();

		if (!sharedContent.mimeType!.startsWith('text')) {
			const isGranted = await this.requestReadStoragePermission();
			if (!isGranted) {
				return Promise.reject();
			}
		}

		// does not support multi-item-sharing yet
		const dialogRoomPicker = (
			<DialogRoomPicker
				onPressRoom={roomId => this.askSendContent(roomId, sharedContent, showTempForwardedMessage)}
				label={sendTo[UiStore.getLanguage()] + '...'}
			/>
		);

		RX.Modal.show(dialogRoomPicker, 'DialogRoomPicker');
	}

	private async askSendContent(
		roomId: string,
		sharedContent: SharedContent,
		showTempForwardedMessage: (roomId: string, message: FilteredChatEvent, tempId: string) => void
	): Promise<void> {
		RX.Modal.dismiss('DialogRoomPicker');

		if (sharedContent.uri.startsWith('content://')) {
			const stat = await ReactNativeBlobUtil.fs.stat(sharedContent.uri).catch(_error => null);
			sharedContent.uri = 'file://' + stat?.path;
		}

		const dialogIncomingContentShare = (
			<DialogIncomingContentShare
				roomId={roomId}
				sharedContent={sharedContent}
				showTempForwardedMessage={showTempForwardedMessage}
			/>
		);

		RX.Modal.show(dialogIncomingContentShare, 'dialogIncomingContentShare');
	}
}

export default new ShareHandlerIncoming();
