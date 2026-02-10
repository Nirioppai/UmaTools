"""
OCR type definitions for skill extraction from Umamusume screenshots.

Defines the data structures returned by the OCR extraction pipeline:
- SkillEntry: Individual skill row data
- SkillOcrResult: Complete extraction result with metadata
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class SkillEntry:
    """
    Represents a single skill row extracted from the Learn screen.

    Attributes:
        name_raw: Raw OCR output text for the skill name
        name_norm: Normalized name (lowercase, trimmed, whitespace collapsed)
        skill_id: Matched skill ID from skills_all.json database, None if not matched
        canonical_name: Canonical skill name if matched, None otherwise
        cost: Skill cost (1-9999), None if OCR fails
        hint_level: Hint level 1-5 if hint badge present, None otherwise
        discount_percent: Discount percentage (10/20/30) if hint present, None otherwise
        obtained: True if red "Obtained" badge is detected
        confidence: Per-field confidence scores (e.g., {"name": 0.95, "cost": 0.99})
        bboxes: Per-field bounding boxes as (x, y, w, h) tuples
    """
    name_raw: str
    name_norm: str
    skill_id: Optional[int] = None
    canonical_name: Optional[str] = None
    cost: Optional[int] = None
    hint_level: Optional[int] = None
    discount_percent: Optional[int] = None
    obtained: bool = False
    confidence: Dict[str, float] = field(default_factory=dict)
    bboxes: Dict[str, Tuple[int, int, int, int]] = field(default_factory=dict)


@dataclass
class SkillOcrResult:
    """
    Complete result from OCR extraction of a Learn screen frame.

    Attributes:
        skills: List of extracted skill entries from visible rows
        skill_points_available: Skill points shown in top bar, None if not visible
        meta: Metadata dict containing:
            - source: "mobile" or "pc" layout detection
            - scale: Estimated UI scale factor
            - list_bbox: Bounding box of skill list region (x1, y1, x2, y2)
            - timing: Processing time in seconds
            - frame_shape: Original frame dimensions (h, w, c)
            - debug_image_path: Path to annotated debug image if debug=True
    """
    skills: List[SkillEntry] = field(default_factory=list)
    skill_points_available: Optional[int] = None
    meta: Dict[str, Any] = field(default_factory=dict)
