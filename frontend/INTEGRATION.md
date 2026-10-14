# Add the Chat Widget to campify-client

## 1. Copy the widget files

```bash
cp ChatWidget.jsx  ../campify-client/src/components/
cp chatWidget.css  ../campify-client/src/components/
```

(Or copy manually — both files live next to each other in `src/components/`.)

## 2. Add the chatbot URL to the client's `.env`

```env
# campify-client/.env
VITE_CHATBOT_URL=https://your-chatbot-service.onrender.com
```

Also add this to **Vercel → Project Settings → Environment Variables**.

For local dev use `http://localhost:4000`.

## 3. Mount `<ChatWidget />` in two places

### `src/components/Layout.jsx` (covers all campground pages)

```jsx
import ChatWidget from './ChatWidget';

const Layout = () => (
  <div className="d-flex flex-column vh-100">
    <Navbar />
    <main className="container mt-5 mb-5 flex-grow-1">
      <FlashMessage />
      <Outlet />
    </main>
    <Footer />
    <ChatWidget />   {/* ← add this */}
  </div>
);
```

### `src/pages/Home.jsx` (Home has its own layout)

```jsx
import ChatWidget from '../components/ChatWidget';

// Inside the returned JSX, just before the closing </div>:
<ChatWidget />
```

Skip the admin layout — Trailie is for visitors only.

## 4. Verify CORS

Make sure the chatbot's `ALLOWED_ORIGINS` env var contains your Vercel domain:

```
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
```

No trailing slash.

## What happens automatically

- On any `/campgrounds/:id` page, the widget detects the campground id from the URL
  and passes it as `campgroundId` in the request body.
- Asking "Is this good for families?" will trigger `get_campground_details` for exactly
  the campground the user is viewing — no extra configuration needed.
- The greeting message and suggestion chips are UI-only and never sent to the API.
