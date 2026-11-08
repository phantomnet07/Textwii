self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the main app to trigger notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    // sender contains the dynamic username (e.g., "Ankur")
    const { title, body, sender, icon } = event.data;
    
    const options = {
      body: body, // Displays message text clearly right under the sender name title
      icon: icon || 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png',
      badge: 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png',
      tag: 'instagram-chat-notification', // Keeps only ONE notification bar active, updating it with new messages
      renotify: true,
      actions: [
        { action: 'like', title: '❤️ Like' },
        { action: 'reply', title: '💬 Reply' }
      ]
    };

    // Displays the actual sender's name (e.g. "Ankur") as the notification title
    event.waitUntil(
      self.registration.showNotification(sender || 'Instagram', options)
    );
  }
});


// Handle clicks on notification or action buttons to redirect to the website
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = '/'; // Redirects to your website

  if (event.action === 'like') {
    // Handle Like action (optional: send signal to server or open site)
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (let client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_ACTION', action: 'like' });
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
    );
  } else {
    // Default click or 'reply' action redirects to the website
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (let client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
    );
  }
});
