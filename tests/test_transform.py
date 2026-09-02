import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import transform  # noqa: E402


def course(**over):
    base = {
        "moduleName": "SOFTWARE REQUIREMENTS ENGINEERING",
        "moduleCode": "WIF2002",
        "credit": 3,
        "yearPeriod": "2024/S2",
        "overallTargetStudent": 120,
        "level": "BACHELOR",
        "faculty": "FACULTY OF COMPUTER SCIENCE AND INFORMATION TECHNOLOGY",
        "continuousAssessmentWeightage": "50~50",
        "examDuration": 7200,
        "levelCode": 3,
        "activities": {},
    }
    base.update(over)
    return base


def activity(day="Tuesday", start="08:00", end="10:00", room="DK2", occs=("1",)):
    return {
        "dayOfWeek": day, "startTime": start, "endTime": end,
        "room": room, "occurrences": list(occs),
    }


class TestTransform(unittest.TestCase):
    def test_single_lecture(self):
        data = [course(activities={"LEC": [activity()]})]
        result = transform.transform_timetable(data)
        self.assertEqual(list(result.keys()), ["WIF2002"])
        occ = result["WIF2002"][0]
        self.assertEqual(occ["occurence"], "1")
        self.assertEqual(occ["module"], "SOFTWARE REQUIREMENTS ENGINEERING")
        self.assertEqual(occ["course_id"], "WIF2002")
        self.assertEqual(len(occ["activities"]), 1)
        act = occ["activities"][0]
        self.assertEqual(act["title"], "lecture")
        self.assertEqual(act["day"], "Tuesday")
        self.assertEqual(act["begin_time"], "08:00")
        self.assertEqual(act["end_time"], "10:00")
        self.assertEqual(act["room"], "DK2")

    def test_multiple_occurrences_split_into_records(self):
        data = [course(activities={"TUT": [activity(day="Wednesday", occs=("1", "2", "3"))]})]
        result = transform.transform_timetable(data)
        occs = result["WIF2002"]
        self.assertEqual([o["occurence"] for o in occs], ["1", "2", "3"])
        self.assertEqual(occs[0]["activities"][0]["title"], "tutorial")

    def test_occurrences_sorted_numerically(self):
        data = [course(activities={"LEC": [activity(occs=("2", "10", "1"))]})]
        result = transform.transform_timetable(data)
        self.assertEqual([o["occurence"] for o in result["WIF2002"]], ["1", "2", "10"])

    def test_exam_adds_dates(self):
        exam = activity(start="08:30", end="10:30", room="EXAM_HOLD_G")
        exam.update({"startDate": "08/07/2025", "endDate": "08/07/2025"})
        data = [course(activities={"EXAM": [exam]})]
        act = transform.transform_timetable(data)["WIF2002"][0]["activities"][0]
        self.assertEqual(act["title"], "exam")
        self.assertEqual(act["start_date"], "08/07/2025")
        self.assertEqual(act["end_date"], "08/07/2025")

    def test_lecturer_becomes_tutor(self):
        lec = activity()
        lec["lecturer"] = {"title": "DR.", "fullName": "AZLINA BINTI ABDUL JALIL"}
        data = [course(activities={"LEC": [lec]})]
        act = transform.transform_timetable(data)["WIF2002"][0]["activities"][0]
        self.assertEqual(act["tutor"], "DR. AZLINA BINTI ABDUL JALIL")

    def test_course_keys_sorted(self):
        data = [
            course(activities={"LEC": [activity()]}),
            course(moduleName="A", moduleCode="AA011001", activities={"LEC": [activity()]}),
        ]
        result = transform.transform_timetable(data)
        self.assertEqual(list(result.keys()), ["AA011001", "WIF2002"])

    def test_empty_activities_produce_no_occurrences(self):
        data = [course(activities={"LEC": []})]
        self.assertEqual(transform.transform_timetable(data)["WIF2002"], [])


if __name__ == "__main__":
    unittest.main()
