self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={title:'DayFlow',body:'Час виконати завдання',url:'/'};
  try{if(event.data)data={...data,...event.data.json()}}catch(e){try{data.body=event.data.text()}catch(_) {}}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:data.icon||undefined,badge:data.badge||undefined,tag:data.tag||'dayflow-task',data:{url:data.url||'/'},renotify:true,vibrate:[200,100,200]}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus' in c)return c.focus()}return clients.openWindow(url)}))});
