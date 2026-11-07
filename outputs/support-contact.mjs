import { SUPPORT_CONFIG } from "./support-config.mjs";
export function normalizedEmail(value) {
  const email=typeof value==="string"?value.trim():"";
  if(!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email))return "";
  if(/@(?:example\.(?:com|org|net)|[^@]+\.(?:invalid|example|test))$/i.test(email))return "";
  return email;
}
export function inquiryMailto(config) {
  const email=normalizedEmail(config.email);if(!email)return null;
  return "mailto:"+email+"?subject="+encodeURIComponent("["+config.appName+"] お問い合わせ")+"&body="+encodeURIComponent("お問い合わせ内容：\r\n\r\n");
}
export async function copyEmail(email,clipboard) {
  const value=normalizedEmail(email);if(!value||typeof clipboard?.writeText!=="function")return false;
  try{await clipboard.writeText(value);return true;}catch{return false;}
}
export function mountSupport(root,config=SUPPORT_CONFIG,platform=globalThis) {
  const href=inquiryMailto(config);if(!href){root.hidden=true;return null;}root.hidden=false;
  const doc=root.ownerDocument;
  const make=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const details=make("details");details.className="business-support-card";
  if(root.hasAttribute("data-support-inline"))details.open=true;
  details.append(make("summary",config.label||"運営へのお問い合わせ"));
  details.append(make("p",config.description||config.appName+"の使い方や不具合について運営者へご連絡いただけます。"));
  const label=make("label","メールアドレス"),input=make("input");
  input.type="text";input.value=normalizedEmail(config.email);input.setAttribute("readonly","");input.setAttribute("aria-label","お問い合わせメールアドレス");input.setAttribute("inputmode","email");
  input.addEventListener("focus",()=>input.select?.());label.append(input);details.append(label);
  const actions=make("div");actions.className="business-support-actions";
  const link=make("a","メールで問い合わせる");link.href=href;
  const button=make("button","メールアドレスをコピー");button.type="button";actions.append(link,button);details.append(actions);
  details.append(make("p","メールアプリが開きます。内容を入力し、ご自身で送信してください。"));
  details.append(make("p","開かない場合は、アドレスをコピーして普段のメールから送信できます。"));
  const status=make("p");status.className="business-support-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");details.append(status);
  button.addEventListener("click",async()=>{
    button.disabled=true;status.textContent="";let copied=false;
    try{copied=await copyEmail(config.email,platform.navigator?.clipboard);}catch{}
    if(copied)status.textContent="メールアドレスをコピーしました。";
    else{input.focus?.();input.select?.();status.textContent="コピーできませんでした。アドレスを選択して手動でコピーしてください。";}
    button.disabled=false;
  });
  root.replaceChildren(details);return{details,input,copyButton:button,status,link};
}
if(typeof document!=="undefined"){
  const start=()=>{
    document.querySelectorAll("[data-business-support]").forEach(root=>mountSupport(root));
    document.addEventListener("click",event=>{
      const button=event.target?.closest?.("[data-business-support-open]");if(!button)return;
      const root=document.getElementById(button.getAttribute("data-business-support-open")),details=root?.querySelector("details");if(!details)return;
      button.closest("dialog")?.close?.();details.open=true;root.scrollIntoView?.({block:"center",behavior:"smooth"});details.querySelector("summary")?.focus();
    });
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
}

