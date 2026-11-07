import test from "node:test";
import assert from "node:assert/strict";
import { starFill, ratingPicker, syncRatingPicker } from "./readtrace-rating.mjs";

test("five visual stars expose ten native half-point radio choices and no slider",()=>{
  const html=ratingPicker(null,()=>'<i data-lucide="star"></i>');
  assert.equal((html.match(/type="radio"/g)||[]).length,10);
  assert.equal((html.match(/class="rating-star"/g)||[]).length,5);
  for(let n=0.5;n<=5;n+=0.5) assert.ok(html.includes(`aria-label="${n}点"`));
  assert.equal(html.includes('type="range"'),false); assert.equal(html.includes(' checked'),false);
});

test("all half-point values have the exact selected radio and matching star fill",()=>{
  for(let n=0.5;n<=5;n+=0.5){
    assert.equal(Array.from({length:5},(_,i)=>starFill(n,i)).reduce((a,b)=>a+b,0),n*100);
    const html=ratingPicker(n,()=>'<i></i>');
    assert.equal((html.match(/ checked/g)||[]).length,1);
    assert.ok(html.includes(`value="${n}" aria-label="${n}点" checked`));
  }
});

test("selection/clear/restore updates native radios without replacing keyboard focus",()=>{
  const inputs=Array.from({length:10},(_,i)=>({value:String((i+1)/2),checked:false}));
  const fills=Array(5).fill('');
  const stars=fills.map((_,i)=>({style:{setProperty:(_,value)=>{fills[i]=value;}}}));
  const picker={dataset:{lastRating:'3'},querySelectorAll:selector=>selector.includes('input')?inputs:stars};
  syncRatingPicker(picker,4.5); assert.equal(inputs[8].checked,true); assert.deepEqual(fills,['100%','100%','100%','100%','50%']);
  syncRatingPicker(picker,null); assert.equal(inputs.some(i=>i.checked),false); assert.ok(fills.every(f=>f==='0%')); assert.equal(picker.dataset.lastRating,'4.5');
  syncRatingPicker(picker,Number(picker.dataset.lastRating)); assert.equal(inputs[8].checked,true);
});
