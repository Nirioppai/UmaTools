"""
OCR package for extracting skill information from Umamusume Learn screen screenshots.

This package provides tools to detect and extract visible skills from game screenshots,
supporting both mobile (portrait) and PC (landscape) layouts.

Basic Usage:
    from ocr import extract_visible_skills, SkillEntry, SkillOcrResult

    # Load an image (BGR numpy array from cv2.imread or similar)
    import cv2
    frame = cv2.imread("screenshot.png")

    # Extract skills
    result = extract_visible_skills(frame)

    for skill in result.skills:
        print(f"{skill.canonical_name or skill.name_raw}: {skill.cost} pts")
        if skill.hint_level:
            print(f"  Hint Lv{skill.hint_level} (-{skill.discount_percent}%)")
        if skill.obtained:
            print("  [Obtained]")

Input Format:
    - BGR numpy array (standard OpenCV format)
    - Supports any resolution (auto-scaling applied)

Output:
    - SkillOcrResult containing list of SkillEntry objects and metadata
"""

from .types import SkillEntry, SkillOcrResult

__all__ = [
    "SkillEntry",
    "SkillOcrResult",
]
