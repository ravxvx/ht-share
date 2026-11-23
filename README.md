# HT Share 2.0 – Chrome Extension

HT Share helps prepare, improve, monitor and schedule social media content for [holistictherapists.ie](https://www.holistictherapists.ie).

## Install

1. Download the ZIP from the [latest main branch](https://github.com/ravxvx/ht-share/archive/refs/heads/main.zip).
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted `ht-share-main` folder.
6. Pin HT Share to the browser toolbar.

For an update, download and extract the new ZIP over a new folder, then use **Reload** on the HT Share card in `chrome://extensions` (or remove the old unpacked folder and load the new one).

## Manual sharing

1. Open an article, event or practitioner listing.
2. Click HT Share.
3. Choose Facebook, Instagram, LinkedIn, X or Groups.
4. Edit the generated caption.
5. Copy/open the platform workflow and publish after reviewing it.

The extension reads Open Graph metadata and JSON-LD structured data from the open page. It creates topic and Irish location hashtags from the available title and description.

## HT Share Studio – new in 2.0

### AI caption generation and editing
- Add your own OpenAI API key in the Studio.
- Generate a fresh caption from the current page title, description, URL and available event details.
- Improve an existing caption for the selected social platform.
- Review and edit the result before sharing.

The API key is stored in Chrome local extension storage and is sent to OpenAI when you use an AI action. OpenAI API usage may incur charges under your own account. Do not share your key or use this feature on a shared browser profile.

### New-content monitoring
- Enable monitoring of the WordPress REST API feed.
- HT Share checks every six hours and can also run a manual scan.
- A browser notification appears when a newer post is detected.

Default feed:
`https://www.holistictherapists.ie/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt`

The default feed monitors WordPress **posts** only. If events or practitioner listings are exposed through a separate public REST endpoint, you can enter that endpoint in the feed field. The first scan establishes a baseline; it does not notify for all existing posts.

### Publishing calendar reminders
- Choose a future date and time for a prepared caption.
- HT Share stores the reminder and triggers a browser notification at the selected time.
- Clicking the reminder opens the source page so you can complete publishing.

**Important:** scheduled reminders are not automatic publishing. Facebook, LinkedIn, Instagram and X require approved API access and platform permissions for direct publishing. HT Share never claims a post has been published; you must complete and verify the publication yourself.

### GitHub update checker
- Check the latest version in the repository's main branch.
- If a newer manifest version is found, HT Share provides the ZIP download link.
- Chrome extensions loaded unpacked still need to be updated/reloaded manually from `chrome://extensions`.

## Groups and history

Save Facebook groups, LinkedIn groups and X communities. HT Share copies a caption and opens the destination; paste it into the platform composer. The local history records that you initiated the share workflow, not that the platform accepted or published it.

## Privacy and permissions

- No social media passwords are requested or stored.
- AI use sends the caption and page details you choose to OpenAI using your API key.
- Monitoring fetches the configured public WordPress feed.
- Scheduled reminders are stored locally in Chrome extension storage.
- The extension uses active-tab scripting, storage, downloads, alarms, notifications and limited host access for the website, OpenAI API and GitHub raw manifest.

## Current limitations

- No unattended or direct social network publishing.
- No background ChatGPT generation without your API key and explicit action.
- The default monitor checks WordPress posts, not every custom post type automatically.
- Group sharing requires you to paste the prepared text and press Publish yourself.
- The update checker detects a newer repository manifest and links to the ZIP; it does not silently replace extension files.
