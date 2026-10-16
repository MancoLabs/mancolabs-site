// Paperwork cost calculator: hours a week per person x people x hourly cost x
// working weeks. Runs entirely in the browser.
import { sendToContact } from '../contact-handoff.js';

export const WEEKS = 50;
const LIMITS = { hours: [0, 80], people: [1, 500], rate: [1, 500] };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function yearlyCost({ hours, people, rate }) {
  const yearHours = hours * people * WEEKS;
  return { yearHours, yearCost: yearHours * rate };
}

export function initCost(section) {
  const form = section.querySelector('form');
  const fields = {
    hours: form.querySelector('#costHours'),
    people: form.querySelector('#costPeople'),
    rate: form.querySelector('#costRate'),
  };
  const out = section.querySelector('.cost-result');
  const total = out.querySelector('.cost-total');
  const detail = out.querySelector('.cost-detail');
  const automate = out.querySelector('.cost-automate');
  const cta = section.querySelector('.cost-cta');
  let announce = 0;
  let last = null;

  const read = () => {
    const v = {};
    for (const [k, el] of Object.entries(fields)) {
      const n = Number(el.value);
      const [lo, hi] = LIMITS[k];
      if (el.value.trim() === '' || !Number.isFinite(n) || n < lo || n > hi) return null;
      v[k] = n;
    }
    return v;
  };

  const update = () => {
    const v = read();
    for (const [k, el] of Object.entries(fields)) {
      const n = Number(el.value);
      const [lo, hi] = LIMITS[k];
      const bad = el.value.trim() !== '' && (!Number.isFinite(n) || n < lo || n > hi);
      if (bad) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
    // Screen readers hear the new total once typing pauses, not on every keystroke.
    out.setAttribute('aria-live', 'off');
    clearTimeout(announce);
    announce = setTimeout(() => out.setAttribute('aria-live', 'polite'), 700);
    if (!v) {
      last = null;
      const empty = Object.values(fields).some((el) => el.value.trim() === '');
      total.textContent = empty ? 'Fill in all three' : 'Check the numbers';
      detail.textContent = `Use hours from 0 to ${LIMITS.hours[1]}, 1 to ${LIMITS.people[1]} people, and an hourly cost from $1 to $${LIMITS.rate[1]}.`;
      automate.textContent = '';
      return;
    }
    const { yearHours, yearCost } = yearlyCost(v);
    last = { ...v, yearHours, yearCost };
    total.textContent = `${money.format(yearCost)} a year`;
    detail.textContent = `That's ${count.format(yearHours)} hours a year of manual work across ${v.people} ${v.people === 1 ? 'person' : 'people'}, based on ${WEEKS} working weeks.`;
    automate.textContent = yearCost > 0
      ? `If software took over even half of this work, you'd get back about ${money.format(yearCost / 2)} and ${count.format(yearHours / 2)} hours a year.`
      : '';
  };

  form.addEventListener('input', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  cta.addEventListener('click', (e) => {
    e.preventDefault();
    const message = last
      ? [
          'I used the paperwork cost calculator.',
          `About ${last.hours} hours a week each, ${last.people} ${last.people === 1 ? 'person' : 'people'}, ${money.format(last.rate)} an hour: about ${money.format(last.yearCost)} a year.`,
          '',
          "I'd like to see what could be automated.",
        ].join('\n')
      : "I'd like to see what paperwork could be automated.";
    sendToContact({ message, service: 'Automate a task' });
  });
  update();
  section.dataset.toolReady = 'true';
}
