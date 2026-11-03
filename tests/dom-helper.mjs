export function createTestDOM(html){
 var ids=new Map();
function decode(s){return String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')}
function attrs(s){var a={};for(var m of s.matchAll(/([\w-]+)(?:="([^"]*)")?/g))a[m[1]]=decode(m[2]||'');return a}
class El {
 constructor(tag='div',a={}){this.tag=tag;this.a=a;this.id=a.id;this.className=a.class||'';this.value=a.value||'';this.style={};this.dataset={};this.textContent='';this.children=[];this.listeners={};this.classList={
 add:(...names)=>{this.className=[...new Set(this.className.split(' ').filter(Boolean).concat(names))].join(' ')},
 remove:(...names)=>{this.className=this.className.split(' ').filter(n=>!names.includes(n)).join(' ')},
 contains:(name)=>this.className.split(' ').includes(name),
 toggle:(name,force)=>{const on=force===undefined?!this.className.split(' ').includes(name):force;if(on)this.classList.add(name);else this.classList.remove(name);return on}
 };if(this.id)ids.set(this.id,this)}
 get innerHTML(){return this._html||''}
 set innerHTML(v){this._html=v;this.children=[];for(var m of v.matchAll(/<(input|textarea|button|span)\b([^>]*?)(?:>([\s\S]*?)<\/\1>|\/?\s*>)/g)){var child=new El(m[1],attrs(m[2]));if(m[1]==='textarea')child.value=decode(m[3]);this.appendChild(child)}}
 appendChild(c){if(c.parentNode)c.remove();c.parentNode=this;this.children.push(c);return c}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null}}
 removeChild(c){c.remove()}
 insertBefore(c,ref){if(c===ref)return;c.remove();var i=this.children.indexOf(ref);if(i<0)throw Error('Missing sibling');this.children.splice(i,0,c);c.parentNode=this}
 get previousElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1]||null}
 get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null}
 matches(q){if(q.startsWith('.'))return this.className.split(' ').includes(q.slice(1));var m=q.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);if(m)return m[2]===undefined?m[1] in this.a:this.a[m[1]]===m[2];return this.tag===q}
 querySelectorAll(q){return this.children.flatMap(c=>[...(c.matches(q)?[c]:[]),...c.querySelectorAll(q)])}
 querySelector(q){return this.querySelectorAll(q)[0]||null}
 addEventListener(t,f){(this.listeners[t] ||= []).push(f)}
 getAttribute(k){return this.a[k]}
 setAttribute(k,v){this.a[k]=v}
 focus(){this.focused=true}
 scrollIntoView(){}
 click(){for(var f of this.listeners.click||[])f({preventDefault(){},stopPropagation(){}})}
}

 for(var m of html.split('<script>')[0].matchAll(/<([\w-]+)\b([^>]*?\bid="[^"]+"[^>]*?)>/g))new El(m[1],attrs(m[2]));
 var doc={hidden:false,getElementById(id){return ids.get(id)||null},createElement(t){return new El(t)},createTextNode(t){var e=new El('text');e.textContent=t;return e},addEventListener(){},querySelectorAll(){return []},body:new El('body')};
 return {ids,document:doc};
}
