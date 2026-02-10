"""
OCR package for extracting skill information from Umamusume Learn screen screenshots.

This package provides tools to detect and extract visible skills from game screenshots,
supporting both mobile (portrait) and PC (landscape) layouts. It uses Tesseract OCR
for text recognition and includes fuzzy matching to canonical skill names.

Quick Start
-----------
    from ocr import extract_visible_skills, SkillEntry, SkillOcrResult
    import cv2

    # Load a screenshot (BGR numpy array)
    frame = cv2.imread("screenshot.png")

    # Extract all visible skills
    result = extract_visible_skills(frame)

    # Check skill points available
    if result.skill_points_available is not None:
        print(f"Available points: {result.skill_points_available}")

    # Process extracted skills
    for skill in result.skills:
        print(f"{skill.canonical_name or skill.name_raw}: {skill.cost} pts")
        if skill.hint_level:
            print(f"  Hint Lv{skill.hint_level} (-{skill.discount_percent}%)")
        if skill.obtained:
            print("  [Obtained]")

Detailed Usage Examples
-----------------------
    # Example 1: Basic extraction with error handling
    from ocr import extract_visible_skills
    import cv2

    frame = cv2.imread("screenshot.png")
    result = extract_visible_skills(frame)

    if "error" in result.meta:
        print(f"Extraction failed: {result.meta['error']}")
    else:
        print(f"Found {len(result.skills)} skills in {result.meta['timing']:.2f}s")

    # Example 2: Filter for affordable skills
    affordable = [s for s in result.skills
                  if s.cost and result.skill_points_available
                  and s.cost <= result.skill_points_available
                  and not s.obtained]

    # Example 3: Access metadata about the extraction
    print(f"Platform detected: {result.meta.get('source')}")
    print(f"UI scale: {result.meta.get('scale')}")
    print(f"Rows detected: {result.meta.get('rows_detected')}")

    # Example 4: Debug mode for troubleshooting
    result = extract_visible_skills(frame, debug=True)
    if result.meta.get("debug_paths"):
        print(f"Debug output: {result.meta['debug_paths'].get('output_dir')}")

    # Example 5: Force platform detection
    result = extract_visible_skills(frame, source="mobile")  # or "pc"

Input Format
------------
    - BGR numpy array (standard OpenCV format from cv2.imread)
    - Supports any resolution (auto-scaling applied internally)
    - Must be 3-channel color image

Output Structure
----------------
    SkillOcrResult:
        - skills: List[SkillEntry] - Extracted skill rows
        - skill_points_available: Optional[int] - Points from top bar
        - meta: Dict - Metadata (timing, platform, confidence, etc.)

    SkillEntry:
        - name_raw: str - Raw OCR text
        - name_norm: str - Normalized name
        - skill_id: Optional[int] - Matched database ID
        - canonical_name: Optional[str] - Official skill name
        - cost: Optional[int] - Skill point cost
        - hint_level: Optional[int] - Hint level 1-5
        - discount_percent: Optional[int] - Discount 10/20/30
        - obtained: bool - Already acquired flag
        - confidence: Dict[str, float] - Per-field confidence
        - bboxes: Dict[str, Tuple] - Per-field bounding boxes

Requirements
------------
    - OpenCV (cv2)
    - numpy
    - pytesseract
    - Tesseract OCR engine with Japanese language data (jpn traineddata)

See Also
--------
    ocr.extractor.extract_visible_skills : Main extraction function
    ocr.types.SkillEntry : Individual skill data structure
    ocr.types.SkillOcrResult : Complete extraction result
"""

from .extractor import extract_visible_skills
from .types import SkillEntry, SkillOcrResult

__all__ = [
    "extract_visible_skills",
    "SkillEntry",
    "SkillOcrResult",
]
