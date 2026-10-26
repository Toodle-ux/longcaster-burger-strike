import {messages} from './messages.mjs?v=9';
const storageKey='burger-strike-language';
export function preferredLanguage(languages=[]) {
  for(const value of languages) {
    const base=String(value).toLowerCase().split(/[-_]/)[0];
    if(['zh','ja','en'].includes(base))return base;
  }
  return 'en';
}
let preference='auto';
try {const saved=globalThis.localStorage?.getItem(storageKey);if(['zh','ja','en'].includes(saved))preference=saved;}catch{}
const browserLanguage=()=>preferredLanguage(globalThis.navigator?.languages??[globalThis.navigator?.language]);
let language=preference==='auto'?browserLanguage():preference;
export const getLanguage=()=>language;
export function t(key,values={}) {
  const text=language==='zh'?key:messages[key]?.[language==='ja'?0:1]??key;
  return text.replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??`{${name}}`));
}
export function setupLanguages(onChange) {
  // Capture only the initial static copy. Runtime messages call t() directly.
  const nodes=[],attributes=[],walker=document.createTreeWalker(document.body,4);
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    const key=node.textContent.trim();if(messages[key])nodes.push({node,key,original:node.textContent});
  }
  for(const node of document.querySelectorAll('[aria-label]')) {
    const key=node.getAttribute('aria-label');if(messages[key])attributes.push({node,key});
  }
  const selects=[...document.querySelectorAll('.language-select')];
  function apply() {
    document.documentElement.lang={zh:'zh-CN',ja:'ja',en:'en'}[language];
    for(const {node,key,original} of nodes)node.textContent=original.replace(key,()=>t(key));
    for(const {node,key} of attributes)node.setAttribute('aria-label',t(key));
    for(const select of selects)select.value=preference;
  }
  for(const select of selects)select.addEventListener('change',()=>{
    preference=['zh','ja','en'].includes(select.value)?select.value:'auto';
    language=preference==='auto'?browserLanguage():preference;
    try {if(preference==='auto')localStorage.removeItem(storageKey);else localStorage.setItem(storageKey,preference);}catch{}
    apply();onChange();
  });
  apply();
}
