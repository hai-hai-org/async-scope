"""blocking finding 해결 안내.

정적 분석이므로 오탐을 내지 않는 게 최우선이다. 지목하지 못하면 측정 안내로 떨어진다.
"""

import pytest

from asyncscope.analysis.recommendations import MEASURE_STEPS, recommend


def _finding(file="service.py", function="handler", line=1, finding_type="blocking"):
    return {
        "type": finding_type,
        "suspect": {
            "source": {"file": file, "function": function, "line": line},
            "certainty": "candidate",
        },
    }


def _write(tmp_path, body: str) -> None:
    (tmp_path / "service.py").write_text(body)


def test_finds_a_known_call_in_a_decorated_function(tmp_path):
    """co_firstlineno는 decorator 줄이라 node.lineno만 비교하면 함수를 못 찾는다."""
    _write(
        tmp_path,
        "import time\n"
        "\n"
        "@app.get('/x')\n"
        "async def handler():\n"
        "    time.sleep(0.3)\n",
    )

    result = recommend(_finding(line=3), tmp_path)

    assert result["kind"] == "known_blocking_call"
    assert result["certainty"] == "candidate"
    assert result["steps"][0]["source"] == {"file": "service.py", "line": 5}


def test_reports_every_known_call_site(tmp_path):
    _write(
        tmp_path,
        "import subprocess\n"
        "import time\n"
        "\n"
        "async def handler():\n"
        "    time.sleep(0.1)\n"
        "    subprocess.run(['ls'])\n"
        "    time.sleep(0.2)\n",
    )

    steps = recommend(_finding(line=4), tmp_path)["steps"]

    assert sorted(step["source"]["line"] for step in steps) == [5, 6, 7]


def test_ignores_calls_inside_nested_functions(tmp_path):
    """중첩 함수는 다른 프레임이다. 이 suspect가 막았다는 근거가 아니다."""
    _write(
        tmp_path,
        "import time\n"
        "\n"
        "async def handler():\n"
        "    def later():\n"
        "        time.sleep(1)\n"
        "    return later\n",
    )

    assert recommend(_finding(line=3), tmp_path)["kind"] == "measure"


def test_unknown_calls_do_not_get_a_guessed_fix(tmp_path):
    """오탐 하나가 Analyzer 전체의 신뢰를 깎는다."""
    _write(
        tmp_path,
        "async def handler():\n"
        "    conn.execute('select 1')\n"
        "    heavy_math()\n",
    )

    result = recommend(_finding(line=1), tmp_path)

    assert result["kind"] == "measure"
    assert result["certainty"] == "unknown"
    assert [step["text"] for step in result["steps"]] == MEASURE_STEPS["blocking"]
    assert all(step["source"] is None for step in result["steps"])


@pytest.mark.parametrize(
    "finding",
    [
        _finding(file="missing.py"),
        _finding(file="../outside.py"),
        _finding(function="other"),
        {"type": "blocking", "suspect": None},
        {"type": "blocking"},
    ],
)
def test_unreadable_or_unmatched_source_falls_back_instead_of_raising(tmp_path, finding):
    _write(tmp_path, "import time\n\nasync def handler():\n    time.sleep(1)\n")
    (tmp_path.parent / "outside.py").write_text("import time\ntime.sleep(1)\n")

    assert recommend(finding, tmp_path)["kind"] == "measure"


def test_unattributed_findings_get_their_own_measurement_steps():
    result = recommend({"type": "unattributed", "suspect": None}, None)

    assert result["kind"] == "measure"
    assert [step["text"] for step in result["steps"]] == MEASURE_STEPS["unattributed"]


def test_syntax_error_in_project_source_does_not_break_the_analyzer(tmp_path):
    _write(tmp_path, "async def handler(:\n")

    assert recommend(_finding(line=1), tmp_path)["kind"] == "measure"
