import React, { ReactElement } from 'react';
import RX from 'reactxp';
import DialogContainer from '../modules/DialogContainer';
import ApiClient from '../matrix/ApiClient';
import { MessageEvent } from '../models/MessageEvent';
import FileHandler from '../modules/FileHandler';
import { DIALOG_WIDTH, SPACING, BUTTON_MODAL_TEXT, FONT_LARGE, BORDER_RADIUS, TRANSPARENT_BACKGROUND,
    MODAL_CONTENT_BACKGROUND } from '../ui';
import UiStore from '../stores/UiStore';
import { messageCouldNotBeSent, cancel, pressSend, fileCouldNotUpload, pressLoad, Languages } from '../translations';
import EventUtils from '../utils/EventUtils';
import RoomTile from '../components/RoomTile';
import { SharedContent } from '../models/SharedContent';
import DataStore from '../stores/DataStore';
import { MessageEventContentInfo_, MessageEventContent_ } from '../models/MatrixApi';
import { FileObject } from '../models/FileObject';
import ImageSizeLocal from '../modules/ImageSizeLocal';
import SpinnerUtils from '../utils/SpinnerUtils';
import AppFont from '../modules/AppFont';
import VideoPlayer from '../modules/VideoPlayer';

const styles = {
    modalScreen: RX.Styles.createViewStyle({
        flex: 1,
        alignSelf: 'stretch',
    }),
    containerModalContent: RX.Styles.createViewStyle({
        width: DIALOG_WIDTH,
    }),
    containerContent: RX.Styles.createViewStyle({
        padding: SPACING,
        marginBottom: SPACING,
        backgroundColor: MODAL_CONTENT_BACKGROUND,
        borderRadius: BORDER_RADIUS,
    }),
    image: RX.Styles.createImageStyle({
        flex: 1,
        borderRadius: BORDER_RADIUS - 2,
    }),
    text: RX.Styles.createTextStyle({
        fontFamily: AppFont.fontFamily,
        textAlign: 'center',
        fontSize: FONT_LARGE,
        margin: SPACING,
    }),
    textDialog: RX.Styles.createTextStyle({
        fontFamily: AppFont.fontFamily,
        textAlign: 'center',
        color: BUTTON_MODAL_TEXT,
        fontSize: FONT_LARGE,
        margin: SPACING * 2,
    }),
};

interface DialogIncomingContentShareProps {
    roomId: string;
    sharedContent: SharedContent;
    showTempForwardedMessage: (roomId: string, message: MessageEvent, tempId: string) => void;
}

interface DialogIncomingContentShareState {
    imageRatio: number;
}

export default class DialogIncomingContentShare extends RX.Component<DialogIncomingContentShareProps, DialogIncomingContentShareState> {

    private contentType = '';
    private imageHeight = 0;
    private imageWidth = 0;
    private language: Languages = 'en';
    private videoHeight: number | undefined;
    private videoWidth: number | undefined;

    constructor(props: DialogIncomingContentShareProps) {
        super(props);

        if (props.sharedContent.mimeType!.startsWith('image')) {
            this.contentType = 'm.image';
        } else if (props.sharedContent.mimeType!.startsWith('text')) {
            this.contentType = 'm.text';
        } else if (props.sharedContent.mimeType!.startsWith('application')) {
            this.contentType = 'm.file';
        } else if (props.sharedContent.mimeType!.startsWith('video')) {
            this.contentType = 'm.video';
        }

        this.state = { imageRatio: 1 }

        this.language = UiStore.getLanguage();
    }

    public async componentDidMount(): Promise<void> {

        if (this.contentType === 'm.image') {

            const imageSize = await ImageSizeLocal.getSize(this.props.sharedContent.uri);

            this.imageWidth = imageSize.width;
            this.imageHeight = imageSize.height;

            this.setState({ imageRatio: this.imageHeight / this.imageWidth });
        }
    }

    private shareContent = async () => {

        RX.Modal.dismiss('dialogIncomingContentShare');

        SpinnerUtils.showModalSpinner('forwardmessagespinner');

        const showError = (tempId: string, errorMessage: string) => {

            const message: MessageEvent = {
                eventId: tempId,
                content: undefined!,
                type: '',
                time: 0,
                senderId: '',
            }

            this.props.showTempForwardedMessage(this.props.roomId, message, tempId);

            const text = (
                <RX.Text style={ styles.textDialog }>
                    { errorMessage }
                </RX.Text>
            );

            RX.Modal.show(<DialogContainer content={ text } modalId={ 'errordialog' }/>, 'errordialog');
        }

        if (this.contentType === 'm.text') {

            const tempId = 'text' + Date.now();

            const messageContent: MessageEventContent_ = {
                body: this.props.sharedContent.uri,
                msgtype: 'm.text',
            };

            const message: MessageEvent = {
                eventId: tempId,
                content: messageContent,
                type: '',
                time: Date.now(),
                senderId: ApiClient.credentials.userIdFull,
            }

            this.props.showTempForwardedMessage(this.props.roomId, message, tempId);

            const linkifyElement = EventUtils.getOnlyUrl(this.props.sharedContent.uri);

            if (linkifyElement) {

                let urlMessageContent: MessageEventContent_ = {
                    msgtype: 'm.text',
                    body: this.props.sharedContent.uri,
                }

                const previewData = await EventUtils.getLinkPreview(linkifyElement);

                if (previewData) {
                    urlMessageContent = {
                        ...urlMessageContent,
                        url_preview: previewData,
                    }
                }

                ApiClient.sendMessage(this.props.roomId, urlMessageContent, tempId)
                    .catch(() => {
                        showError(tempId, messageCouldNotBeSent[this.language]);
                    });

            } else {

                ApiClient.sendMessage(this.props.roomId, messageContent, tempId)
                    .catch(() => {
                        showError(tempId, messageCouldNotBeSent[this.language]);
                    });
            }

        } else {

            const tempId = 'media' + Date.now();

            const fetchProgress = (_text: string, _progress: number) => {
                // not used yet
            }

            const content = {
                body: this.props.sharedContent.fileName,
                msgtype: this.contentType,
            };

            const message: MessageEvent = {
                eventId: tempId,
                content: content,
                type: '',
                time: Date.now(),
                senderId: ApiClient.credentials.userIdFull,
            }

            this.props.showTempForwardedMessage(this.props.roomId, message, tempId);

            const file: FileObject = {
                uri: this.props.sharedContent.uri,
                name: this.props.sharedContent.fileName!,
                size: this.props.sharedContent.fileSize,
                type: this.props.sharedContent.mimeType!,
                imageHeight: this.imageHeight,
                imageWidth: this.imageWidth,
            }

            FileHandler.uploadFile(ApiClient.credentials, file, fetchProgress, true)
                .then(fileUri => {

                    if (fileUri) {
                        const messageType = EventUtils.messageMediaType(file.type);
                        let mediaHeight: number | undefined;
                        let mediaWidth: number | undefined;

                        switch (messageType) {
                            case 'm.image':
                                mediaHeight = file.imageHeight;
                                mediaWidth = file.imageWidth;
                                break;

                            case 'm.video':
                                mediaHeight = this.videoHeight;
                                mediaWidth = this.videoWidth;
                                break;

                            default:
                                mediaHeight = undefined;
                                mediaWidth = undefined;
                                break;
                        }

                        const messageContentInfo: MessageEventContentInfo_ = {
                            h: mediaHeight,
                            w: mediaWidth,
                            size: file.size!,
                            mimetype: file.type,
                        }

                        const messageContent: MessageEventContent_ = {
                            msgtype: messageType,
                            body: file.name,
                            info: messageContentInfo,
                            url: fileUri,
                        }

                        ApiClient.sendMessage(this.props.roomId, messageContent, tempId)
                            .catch(() => {
                                showError(tempId, messageCouldNotBeSent[this.language]);
                            });

                    } else {
                        throw new Error('');
                    }
                })
                .catch(_error => {
                    showError(tempId, fileCouldNotUpload[this.language])
                });
        }
    }

    public render(): JSX.Element | null {

        const newestRoomEvent = DataStore.getNewRoomEvents(this.props.roomId)[0];

        let content: ReactElement;

        if (this.contentType === 'm.image') {

            const heightStyle = RX.Styles.createViewStyle({
                height: (DIALOG_WIDTH - 2 * SPACING) * this.state.imageRatio,
                maxHeight: 480,
            }, false);

            content = (
                <RX.View style={ styles.containerModalContent }>
                    <RX.View style={ styles.containerContent } >
                        <RX.Image
                            resizeMode={ 'contain' }
                            style={ [styles.image, heightStyle] }
                            source={ this.props.sharedContent.uri }
                        />
                    </RX.View>
                    <RoomTile
                        key={ this.props.roomId }
                        roomId={ this.props.roomId }
                        newestRoomEvent={ newestRoomEvent }
                        nonShadeable={ true }
                    />
                </RX.View>
            );

        } else if (this.contentType === 'm.video') {

            const setDimensions = (videoHeight: number, videoWidth: number) => {
                this.videoHeight = videoHeight;
                this.videoWidth = videoWidth;
            }

            content = (
                <RX.View style={ styles.containerModalContent }>
                    <RX.View style={ styles.containerContent } >
                        <VideoPlayer
                            uri={ this.props.sharedContent.uri }
                            autoplay={ false }
                            setDimensions={ setDimensions }
                        />
                    </RX.View>
                    <RoomTile
                        key={ this.props.roomId }
                        roomId={ this.props.roomId }
                        newestRoomEvent={ newestRoomEvent }
                        nonShadeable={ true }
                    />
                </RX.View>
            );

        } else if (this.contentType === 'm.file') {

            content = (
                <RX.View style={ styles.containerModalContent }>
                    <RX.View style={ styles.containerContent } >
                        <RX.Text style={ [styles.text, { fontWeight: 'bold'}] }>
                            { this.props.sharedContent.fileName }
                        </RX.Text>
                    </RX.View>
                    <RoomTile
                        key={ this.props.roomId }
                        roomId={ this.props.roomId }
                        newestRoomEvent={ newestRoomEvent }
                        nonShadeable={ true }
                    />
                </RX.View>
            );

        } else {

            content = (
                <RX.View style={ styles.containerModalContent }>
                    <RX.View style={ styles.containerContent } >
                        <RX.Text style={ styles.text }>
                            { this.props.sharedContent.uri }
                        </RX.Text>
                    </RX.View>
                    <RoomTile
                        key={ this.props.roomId }
                        roomId={ this.props.roomId }
                        newestRoomEvent={ newestRoomEvent }
                        nonShadeable={ true }
                    />
                </RX.View>
            );
        }

        const roomType = DataStore.getRoomType(this.props.roomId);

        const shareDialog = (
            <DialogContainer
                content={ content }
                confirmButton={ true }
                confirmButtonText={ roomType === 'notepad' ? pressLoad[this.language] : pressSend[this.language] }
                cancelButton={ true }
                cancelButtonText={ cancel[this.language] }
                onConfirm={ this.shareContent }
                onCancel={ () => RX.Modal.dismissAll() }
                backgroundColorContent={ TRANSPARENT_BACKGROUND }
            />
        )

        return (
            <RX.View style={ styles.modalScreen }>
                { shareDialog }
            </RX.View>
        );
    }
}
