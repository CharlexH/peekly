// This file is the source for the tracking script.
// It gets minified by scripts/build-tracker.js to < 1KB gzipped.
// The output is embedded as a string in src/routes/tracker.ts

export const TRACKER_SCRIPT = `(function(){
'use strict';
var d=document,w=window,l=location,n=navigator;
var s=d.currentScript;
if(!s)return;
var api=s.dataset.api||(new URL(s.src).origin+'/api/collect');
var site=s.dataset.site;
if(!site)return;
if(n.doNotTrack==='1')return;
if(/^localhost$|^127\\.|^0\\.0\\.0\\.0$/.test(l.hostname)||l.protocol==='file:')return;
var last;
function t(name,meta){
if(name==='pageview'&&last===l.pathname)return;
if(name==='pageview')last=l.pathname;
var p={n:name,u:l.href,r:d.referrer,w:w.innerWidth,s:site};
if(meta)p.m=meta;
var b=JSON.stringify(p);
if(n.sendBeacon){n.sendBeacon(api,b)}
else{fetch(api,{method:'POST',body:b,keepalive:true})}
}
var ps=Date.now();
d.addEventListener('visibilitychange',function(){
if(d.visibilityState==='hidden'){t('pageleave',{d:Math.round((Date.now()-ps)/1e3)})}
});
var hp=history.pushState;
history.pushState=function(){hp.apply(this,arguments);t('pageview');ps=Date.now()};
w.addEventListener('popstate',function(){t('pageview');ps=Date.now()});
t('pageview');
d.addEventListener('click',function(e){
var a=e.target;while(a&&a.tagName!=='A')a=a.parentElement;
if(!a||!a.href)return;
try{var h=new URL(a.href);if(h.hostname===l.hostname)return;
t('outbound',{url:a.href,text:(a.innerText||'').substring(0,100)})}catch(x){}
},true);
w.peekly=function(name,meta){t(name,meta)};
})();`;
