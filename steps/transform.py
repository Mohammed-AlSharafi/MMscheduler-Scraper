"""Transform the clean step's output (timetable_data.json) into the mmscheduler app
format: {course_id: [occurrence_record, ...]}.

Reads timetable_data.json from the current working directory. This is a port of
the old toolmod/main.py with the same behavior; unused imports and dead code
were dropped, and warnings go to stderr instead of errors.txt.
"""
import argparse
import json
import sys

ACTIVITY_TYPE_MAP = {
    "LEC": "lecture",
    "EXAM": "exam",
    "TUT": "tutorial",
    "LAB": "lab",
    "ONL": "online",
    "REPROJECT": "reproject",
    "SEM": "seminar",
    "PRA": "practical",
}


def transform_timetable(timetable_data):
    """timetable_data: list of module dicts from the clean step (steps/clean.mjs).
    Returns {module_code: [occurrence_dict, ...]} in app format."""
    updated_data = {}
    for course in timetable_data:
        base = {
            "module": course["moduleName"],
            "course_id": course["moduleCode"],
            "credits": course["credit"],
            "yearPeriod": course["yearPeriod"],
            "overallTargetStudent": course["overallTargetStudent"],
            "level": course["level"],
            "faculty": course["faculty"],
            "continuousAssessmentWeightage": course["continuousAssessmentWeightage"],
            "examDuration": course["examDuration"],
            "levelCode": course["levelCode"],
        }

        occurrences = {}
        for activity_type, details_list in course["activities"].items():
            for details in details_list:
                if "occurrences" not in details:
                    print(
                        f"WARN: {course['moduleCode']} activity {activity_type} has no occurrences",
                        file=sys.stderr,
                    )
                    continue

                for occ in set(details["occurrences"]):
                    occurrences.setdefault(occ, dict(base))
                    occurrences[occ]["occurence"] = occ
                    occurrences[occ].setdefault("activities", [])
                    activity = {
                        "title": ACTIVITY_TYPE_MAP[activity_type],
                        "day": details["dayOfWeek"],
                        "room": details["room"],
                        "begin_time": details["startTime"],
                        "end_time": details["endTime"],
                    }
                    if details.get("lecturer"):
                        activity["tutor"] = "{} {}".format(
                            details["lecturer"].get("title", ""),
                            details["lecturer"].get("fullName", ""),
                        )
                    if ACTIVITY_TYPE_MAP[activity_type] == "exam":
                        activity["start_date"] = details["startDate"]
                        activity["end_date"] = details["endDate"]
                    occurrences[occ]["activities"].append(activity)

        updated_data[course["moduleCode"]] = occurrences

    return convert_to_output_format(updated_data)


def convert_to_output_format(tracking_data):
    data = {
        code: sorted(list(occ.values()), key=lambda x: x["occurence"].rjust(2, " "))
        for code, occ in tracking_data.items()
    }
    return {key: data[key] for key in sorted(data.keys())}


def main():
    parser = argparse.ArgumentParser(
        description="Restructure timetable_data.json into the app format"
    )
    parser.add_argument("output", help="Path to write the output JSON")
    args = parser.parse_args()

    with open("timetable_data.json") as f:
        timetable_data = json.load(f)

    output = transform_timetable(timetable_data)

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)


if __name__ == "__main__":
    main()
