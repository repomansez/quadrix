# ![quadrix](https://quadrix.chat/quadrix_name.png)

- Minimal, simple, multi-platform chat app for the [Matrix](https://github.com/matrix-org/) protocol
- Does not support [E2EE](https://en.wikipedia.org/wiki/End-to-end_encryption)
- No customization (almost), no widgets, no bots, no phone calls
- Integrated video-conferencing with [Jitsi Meet](https://github.com/jitsi/jitsi-meet/)
- Programmed with [ReactXP](https://github.com/Microsoft/reactxp)
- React Native apps for Android and iOS
- Electron apps for Windows, MacOS, and Linux
- Web app (unstable, glitchy UI, for testing only) at [app.quadrix.chat](https://app.quadrix.chat)
- Push notifications on mobile devices with Firebase Cloud Messaging
- Unique top-down messaging feed

## Use cases:

- Private homeserver owners looking to get their non-tech friends + family to chat on Matrix
- Small organizations or companies wanting a simple, self-hosted, open-source instant messaging solution

## One code base, several platforms:

<p>
    <a href="https://play.google.com">
        <img alt="Get it on Google Play" src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" height=48>
    </a>
    <a href="https://apps.apple.com">
        <img alt="Download on the App Store" src="https://linkmaker.itunes.apple.com/images/badges/en-us/badge_appstore-lrg.svg" height=48>
    </a>
</p>

<p>
    <a href="https://snapcraft.io/">
        <img alt="Get it from the Snap Store" src="https://snapcraft.io/static/images/badges/en/snap-store-black.svg" height=48>
    </a>
    <a href="https://www.microsoft.com/store">
        <img alt="Get it from Microsoft" src="https://developer.microsoft.com/store/badges/images/English_get-it-from-MS.png" height=48>
    </a>
    <a href="https://apps.apple.com/">
        <img alt="Download on the Mac App Store" src="https://upload.wikimedia.org/wikipedia/commons/5/5d/Download_on_the_Mac_App_Store_Badge_US-UK_RGB_blk.svg" height=48>
    </a>
</p>

## Installation:
For all platforms:
- `npm install`

Additionally for iOS:
- `cd ios`
- `pod install`

## Main Commands:

- `npm run start:web` - runs the Web version of the app and serves it on http://localhost:9999
- `npm run start:android` - runs the Android version of the app and opens it on a connected Android device
- `npm run start:ios` - runs the iOS version of the app and opens it on a connected iPhone

## Issues & Bugs:

Please report issues, problems, crashes, bugs, etc. in the [Issues](https://github.com/alariej/quadrix/issues) section of this repository.

## Terms / Privacy / License

quadrix is provided without warranty of any kind. In no event shall the copyright holder be liable for any claim, damages or other liability arising from the use of this software.

When using quadrix, you are required to abide by any applicable laws. You can not use quadrix for unlawful, illegal, defamatory, harmful, abusive, hateful, or ethnically offensive purposes.

The quadrix apps do not collect any information whatsover: No user ID's, no IP addresses, no messaging statistics, no usage data, no crash analytics, no nothing. However, the homeserver provider chosen by the user, the push notification service for mobile devices ([Firebase Cloud Messaging](https://firebase.google.com/support/privacy)) and the videoconferencing service ([Jitsi Meet](https://jitsi.org/meet-jit-si-privacy/)) might collect usage data and other information for their own purposes. Please refer to their respective privacy policies for additional information.

quadrix is released under the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.html), requiring everyone to share their modifications when they also share the software in public. That aspect is commonly referred to as Copyleft.

Copyright (c) 2021 Jean-François Alarie

## Contact:

- Matrix: @alariej:matrix.org
- Matrix: #quadrix:matrix.org
- Email: alariej (at) quadrix.chat
- LinkedIn: [www.linkedin.com/in/alariej](https://www.linkedin.com/in/alariej)
