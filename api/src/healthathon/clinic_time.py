from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from healthathon.config import get_settings


def zone() -> ZoneInfo:
    return ZoneInfo(get_settings().clinic_timezone)


def now() -> datetime:
    return datetime.now(zone())


def today() -> date:
    return now().date()


def local(t: datetime) -> datetime:
    """A stored timestamp as clinic wall time, offset included."""
    return t.astimezone(zone())


def at(day: date, wall: time) -> datetime:
    return datetime.combine(day, wall, zone())


def midnight(day: date) -> datetime:
    return at(day, time())


def day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """[start 00:00, the day after end 00:00) in clinic time."""
    return midnight(start), midnight(end + timedelta(days=1))


def week_start(day: date) -> date:
    """The Monday of the week, so the survey is asked once a week."""
    return day - timedelta(days=day.weekday())
