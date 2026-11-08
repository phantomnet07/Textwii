# Instagram Direct Message - Private 2-Person Chat

A private, minimalist 2-person messaging website styled 1:1 after **Instagram Direct Messages** with real-time synchronization, voice notes, photo sharing, profile pictures with permanent server sync, user custom stickers, message replies, long-press actions, hover actions, swipe gestures, and server-side chat history.

---

## 🌟 Key Features & Updates

1. **Profile Picture Upload with Server Sync (Permanent)**:
   - **user1** can upload & change his own profile picture from the Details modal (`ⓘ`). Only user1 can edit it.
   - **user2** can upload & change her own profile picture from the Details modal (`ⓘ`). Only user2 can edit it.
   - When user1 changes his picture, user2's chat header, incoming message avatars, and typing indicators update in real-time.
   - When user2 changes her picture, user1's chat header, incoming message avatars, and typing indicators update in real-time.
   - Avatars are stored permanently in `./data/avatars/` and cached locally across device restarts.

2. **Android Emojis & Reaction System**:
   - Tapping `+` on the reaction menu opens the full **Instagram / Android Reaction Sheet**.
   - Reacting with an emoji **applies the reaction directly to that message** without putting text in the message box.
   - Emojis are grouped in one continuous vertically-scrolling section with quick category jump tabs (`😀`, `👋`, `❤️`, `🐶`, `🍏`, `⚽`, `🚗`, `💯`).
   - On **Mobile (Phone)**: Users type messages using their native Gboard/system keyboard; website emoji grid is hidden from message input so it doesn't clutter the screen, while the reaction sheet is styled 1:1 with Instagram mobile.
   - On **Desktop (PC)**: Chat input includes the emoji button to type emojis into the message box, and hovering over messages shows hover action pills.

3. **Hover Action Controls (Desktop/PC) & Long-Press (Mobile)**:
   - On PC / Desktop, hovering over any message reveals 3 action buttons:
     - `☺` **React**: Opens the emoji reaction pill (`❤️ 😂 😮 😢 😡 👍 ➕`).
     - `⤺` **Reply**: Activates reply mode with quoted preview snippet.
     - `⋮` **More Options**: Opens the full action card (Edit, Copy, Unsend, Delete for me).
   - On mobile, long-pressing any bubble triggers the exact same actions!

4. **Section Time Dividers (Instagram Style)**:
   - Center headers (e.g. `Thu 10:59 PM`, `Yesterday 8:02 PM`) automatically divide conversation clusters whenever a time gap occurs.

5. **Accurate "Seen" Status**:
   - Outgoing messages display real-time seen status below the last sent message (`Seen just now`, `Seen 2m ago`, `Seen Yesterday at 10:59 PM`).

6. **Private Credentials (Per Admin Security)**:
   - Each admin can **ONLY** view and edit their **OWN** credentials.
   - Passcodes default to: Admin 1 = `user1`, Admin 2 = `user2`.

7. **Photo Modes (View Once, Replay, Keep in Chat)**:
   - 💣 **View once**: Disappears after 1 view.
   - 🔄 **Allow replay**: Up to 2 views before expiring.
   - ♾️ **Keep in chat**: Permanent photo with full lightbox and Download button.

---

## 🚀 How to Run Locally

```bash
cd c:\Users\user1\OneDrive\Desktop\msg
node server.js
```
Open **`http://localhost:3000`** in your browser:
- Log in with passcode `user1` in Window 1.
- Log in with passcode `user2` in Window 2 (or on your phone connected to the same Wi-Fi: `http://<your-pc-ip>:3000`).

---

## ☁️ How to Add Server Storage for 100% Free Forever

Here are the 3 best, battle-tested methods to host this server and persistent storage **free forever** without paying or providing a credit card.

---

### Option 1: Glitch.com (Easiest - 100% Free Forever with Persistent Disk)
Glitch gives you a full Node.js environment with permanent file storage and a public HTTPS URL. No credit card required.

1. Go to **[glitch.com](https://glitch.com)** and sign up for a free account.
2. Click **"New Project"** -> **"Import from GitHub"** (or choose "glitch-hello-node").
3. Upload or paste your project files:
   - `server.js`
   - `package.json`
   - `index.html`
   - Create a folder named `data`
4. In Glitch's terminal (Tools -> Terminal), verify dependencies by running:
   ```bash
   npm install
   ```
5. Click **"Share"** -> **"Live Site"**.
   - You get a permanent free link like: `https://your-private-chat.glitch.me`
   - All files in `data/` (messages, avatars, credentials, stickers) stay saved forever!

---

### Option 2: Render.com (Free Web Service + Persistent Free MongoDB/Supabase)
Render provides free Node.js hosting. Because Render free web services have an ephemeral disk on restart, combine Render with a free cloud database/storage:

1. Create a free account at **[render.com](https://render.com)**.
2. Push your project folder to a private or public GitHub repository.
3. In Render Dashboard, click **"New +"** -> **"Web Service"**.
4. Connect your GitHub repository.
5. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
6. Click **"Create Web Service"**.
7. Render gives you an HTTPS URL like `https://my-instagram-dm.onrender.com`.

---

### Option 3: Cloudflare Tunnel from Home PC (100% Free Forever, Unlimited Storage)
If you want to keep all data directly on your own computer or home mini-PC forever:

1. Install **Cloudflare Tunnel (cloudflared)** on your PC:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. Start your local server:
   ```powershell
   cd c:\Users\user1\OneDrive\Desktop\msg
   node server.js
   ```
3. In another terminal, run:
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```
4. Cloudflare gives you a free, secure `https://<random-id>.trycloudflare.com` address instantly.
5. Both user1 and user2 can open this link on phones and computers anywhere in the world.
   - All pictures, voice notes, stickers, and credentials are saved directly on your local hard drive in `./data/` forever!
