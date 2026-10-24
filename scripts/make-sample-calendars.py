#!/usr/bin/env python3
"""Generates a realistic two-parent, two-kid family's calendars (Oct 19 - Dec 20, 2026)
as .ics files for trying the app. Times are floating (no timezone), so they show as
written wherever the app is opened.  Usage: make-sample-calendars.py OUT_DIR"""
import sys, pathlib
from datetime import date, timedelta

START = date(2026, 10, 19)  # a Monday
UNTIL = "20261220T000000"
DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def first_on(days):
    d = START
    while DAYS[d.weekday()] not in days:
        d += timedelta(days=1)
    return d


def stamp(d, hhmm):
    return f"{d:%Y%m%d}T{hhmm.replace(':', '')}00"


class Cal:
    def __init__(self, name):
        self.name, self.events, self.n = name, [], 0

    def _add(self, lines):
        self.n += 1
        uid = f"{self.name.lower()}-{self.n}@family-atc.sample"
        self.events.append(["BEGIN:VEVENT", f"UID:{uid}", "DTSTAMP:20261019T000000Z", *lines, "END:VEVENT"])

    def weekly(self, title, loc, days, start, end, interval=1, exdates=(), first=None):
        d = first or first_on(days)
        lines = [f"DTSTART:{stamp(d, start)}", f"DTEND:{stamp(d, end)}", f"SUMMARY:{title}"]
        if loc: lines.append(f"LOCATION:{loc}")
        lines.append(f"RRULE:FREQ=WEEKLY;INTERVAL={interval};BYDAY={','.join(days)};UNTIL={UNTIL}")
        for x in exdates: lines.append(f"EXDATE:{stamp(x, start)}")
        self._add(lines)

    def once(self, title, loc, d, start, end, free=False):
        lines = [f"DTSTART:{stamp(d, start)}", f"DTEND:{stamp(d, end)}", f"SUMMARY:{title}"]
        if loc: lines.append(f"LOCATION:{loc}")
        if free: lines.append("TRANSP:TRANSPARENT")
        self._add(lines)

    def daily(self, title, loc, d, days, start, end):
        self._add([f"DTSTART:{stamp(d, start)}", f"DTEND:{stamp(d, end)}", f"SUMMARY:{title}",
                   *([f"LOCATION:{loc}"] if loc else []), f"RRULE:FREQ=DAILY;COUNT={days}"])

    def allday(self, title, d):
        self._add([f"DTSTART;VALUE=DATE:{d:%Y%m%d}", f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}", f"SUMMARY:{title}"])

    def text(self):
        return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Family ATC//Sample//EN",
                            f"X-WR-CALNAME:{self.name}", *[l for e in self.events for l in e], "END:VCALENDAR", ""])


D = date
mom, dad, ada, ben = Cal("Mom"), Cal("Dad"), Cal("Ada"), Cal("Ben")

# Mom: office most days, short Tue/Fri; yoga Saturdays
mom.weekly("Work", "Downtown Office", ["MO", "WE", "TH"], "08:30", "17:00")
mom.weekly("Work", "Downtown Office", ["TU", "FR"], "08:30", "15:30")
mom.weekly("Yoga", "Lotus Studio", ["SA"], "08:30", "09:30")
mom.weekly("Book club", "Cafe Verona", ["WE"], "19:00", "21:00", interval=2, first=D(2026, 10, 21))
mom.once("Client dinner", "Harbor Grill", D(2026, 10, 27), "16:00", "19:00")
mom.once("Lunch (tentative)", "", D(2026, 10, 30), "12:00", "13:00", free=True)
mom.once("Dentist", "Smile Dental", D(2026, 11, 4), "15:30", "16:30")
mom.daily("Denver conference", "Denver Convention Center", D(2026, 11, 9), 3, "07:00", "21:00")
mom.once("Parent-teacher conferences", "Lincoln Elementary", D(2026, 11, 12), "16:00", "17:00")
mom.allday("Thanksgiving", D(2026, 11, 26))
mom.once("Board presentation", "Downtown Office", D(2026, 12, 10), "17:30", "19:30")

# Dad: early shifts; golf every other Saturday
dad.weekly("Work (early shift)", "Plant 3", ["MO", "FR"], "07:30", "16:00")
dad.weekly("Work (early shift)", "Plant 3", ["TU", "WE", "TH"], "07:00", "15:00")
dad.weekly("Five-a-side soccer", "Pine Hills Rec Center", ["TH"], "19:30", "21:00")
dad.weekly("Golf", "Pine Hills Golf Club", ["SA"], "08:00", "12:00", interval=2, first=D(2026, 10, 31))
dad.once("Regional training", "Regional Training Center", D(2026, 11, 4), "13:00", "17:30")
dad.allday("Thanksgiving", D(2026, 11, 26))
dad.once("Company holiday party", "Harbor Grill", D(2026, 12, 10), "18:00", "21:00")

# Ada, 11
ada.weekly("Soccer practice", "Riverside Park", ["TU", "TH"], "16:30", "18:00")
away = [D(2026, 11, 7), D(2026, 11, 21)]
ada.weekly("Soccer game", "Riverside Park", ["SA"], "09:00", "10:30", exdates=away)
for d in away: ada.once("Soccer game (away)", "Eastside Fields", d, "09:00", "10:30")
ada.weekly("Piano lesson", "Harmony Music Studio", ["WE"], "16:00", "16:45", exdates=[D(2026, 12, 2)])
ada.weekly("Robotics club", "Lincoln Library", ["WE"], "17:15", "18:15", exdates=[D(2026, 12, 2)])
ada.once("Piano recital", "Harmony Music Studio", D(2026, 12, 2), "16:00", "17:00")
ada.once("Robotics club (early start)", "Lincoln Library", D(2026, 12, 2), "17:05", "18:15")
ada.weekly("Math tutor", "", ["MO"], "16:00", "17:00")  # no location: the radar can't plan this ride
ada.allday("Halloween", D(2026, 10, 31))
ada.once("Trick-or-treating", "Maple Street", D(2026, 10, 31), "17:30", "19:30")
ada.once("Dentist", "Smile Dental", D(2026, 11, 3), "15:30", "16:00")
ada.allday("Half day, no school", D(2026, 11, 20))
ada.once("Winter concert", "Lincoln Elementary", D(2026, 12, 10), "18:30", "20:00")

# Ben, 8
ben.weekly("Swim lessons", "Westside YMCA", ["TU"], "16:30", "17:15")
ben.weekly("Art class", "Harmony Music Studio", ["TH"], "16:00", "17:00")
ben.weekly("Cub Scouts", "St. Mark's Church Hall", ["MO"], "18:30", "19:30")
ben.once("Trick-or-treating", "Maple Street", D(2026, 10, 31), "17:30", "19:30")
ben.once("Dentist", "Smile Dental", D(2026, 11, 3), "15:30", "16:00")
ben.once("Leo's birthday party", "Jump Zone", D(2026, 11, 14), "10:00", "12:00")
ben.once("Scout hike", "Greenwood Trailhead", D(2026, 11, 21), "09:00", "12:00")
ben.once("Mia's birthday party", "Jump Zone", D(2026, 11, 21), "10:00", "12:00")  # double-booked with the hike

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for c in (mom, dad, ada, ben):
    (out / f"{c.name}.ics").write_text(c.text(), newline="")
