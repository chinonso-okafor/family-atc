// ICS parsing: turns a calendar feed into flat event occurrences for a date range.
// Recurring events (RRULE) and their moved/cancelled instances are expanded here,
// so everything downstream only ever sees concrete start/end times.
import ICAL from 'ical.js';

const MAX_OCCURRENCES = 2000; // guard against unbounded RRULEs

export function parseIcs(text, { person, rangeStart, rangeEnd }) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(tz);
  }

  const masters = new Map();
  const exceptions = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out = [];
  const push = (item, startTime, endTime) => {
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const start = startTime.toJSDate();
    const end = endTime ? endTime.toJSDate() : start;
    if (end <= rangeStart || start >= rangeEnd) return;
    out.push({
      id: `${person}:${item.uid}:${start.getTime()}`,
      person,
      title: item.summary || '(busy)',
      location: (item.location || '').trim(),
      start,
      end,
      allDay: startTime.isDate,
      // TRANSP:TRANSPARENT means "show as free" in Google/Outlook
      free: item.component.getFirstPropertyValue('transp') === 'TRANSPARENT',
    });
  };

  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      push(event, event.startDate, event.endDate);
      continue;
    }
    const it = event.iterator();
    let next;
    let n = 0;
    while ((next = it.next()) && n++ < MAX_OCCURRENCES) {
      if (next.toJSDate() >= rangeEnd) break;
      const occ = event.getOccurrenceDetails(next);
      push(occ.item, occ.startDate, occ.endDate);
    }
  }

  return out.sort((a, b) => a.start - b.start);
}
