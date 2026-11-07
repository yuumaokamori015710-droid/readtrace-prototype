export function starFill(value, index) {
  return Math.max(0, Math.min(1, (value || 0) - index)) * 100;
}

export function ratingPicker(value, icon) {
  return `<div class="rating-picker" id="rating-picker" role="radiogroup" aria-label="星の評価" data-last-rating="${value || 3}">${Array.from({ length: 5 }, (_, index) => `<span class="rating-star" style="--star-fill:${starFill(value, index)}%"><span class="rating-star-base" aria-hidden="true">${icon("star")}</span><span class="rating-star-fill" aria-hidden="true">${icon("star")}</span>${[0.5, 1].map((part, half) => {
    const point = index + part;
    return `<label class="rating-hit rating-hit-${half}" title="${point}点"><input type="radio" name="rating" value="${point}" aria-label="${point}点" ${value === point ? "checked" : ""}><span class="rating-hit-focus" aria-hidden="true"></span></label>`;
  }).join("")}</span>`).join("")}</div><output id="rating-value" aria-live="polite">${value === null ? "未評価" : `${Number(value).toFixed(1)}点`}</output>`;
}

export function syncRatingPicker(picker, value) {
  if (value !== null) picker.dataset.lastRating = String(value);
  picker.querySelectorAll('input[name="rating"]').forEach(input => { input.checked = value !== null && Number(input.value) === value; });
  picker.querySelectorAll('.rating-star').forEach((star, index) => star.style.setProperty('--star-fill', `${starFill(value, index)}%`));
}
