// The booking dialog: Google's appointment page in an iframe, opened by any
// "Book a free call" link (data-booking; see initBooking in main.js). This file
// and everything from Google load on the first click, never with the page.
// After that the calendar stays loaded, so reopening is instant. On phones the
// dialog fills the screen (main.css).
let dialog = null;
let opener = null;

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'booking';
  dialog.setAttribute('aria-labelledby', 'booking-title');
  dialog.innerHTML = `
    <div class="booking-inner">
      <div class="booking-head">
        <h2 id="booking-title">Book a free 30-minute call</h2>
        <button class="btn ghost booking-close" type="button">Close</button>
      </div>
      <div class="booking-frame">
        <p class="booking-loading">Loading the calendar</p>
        <iframe title="Booking calendar: pick a time for a free 30-minute call with Manco Labs"></iframe>
      </div>
      <p class="booking-alt"><a class="cta-alt" href="/#contact">or send a message instead</a></p>
    </div>`;

  const frame = dialog.querySelector('iframe');
  frame.addEventListener('load', () => dialog.classList.add('is-loaded'), { once: true });
  frame.src = __BOOKING_URL__;

  dialog.querySelector('.booking-close').addEventListener('click', () => dialog.close());
  // A click on the dimmed backdrop lands on the dialog itself (.booking-inner fills it).
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  // "Send a message" goes to the contact form, so get out of its way.
  dialog.querySelector('.booking-alt a').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('booking-open');
    opener?.focus();
  });
  document.body.append(dialog);
}

export function openBooking(link) {
  if (!dialog) build();
  opener = link;
  document.documentElement.classList.add('booking-open');
  dialog.showModal();
  dialog.querySelector('.booking-close').focus();
}
