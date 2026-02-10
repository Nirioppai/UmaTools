"""
Debug visualization module for Umamusume skill OCR.

This module provides debug visualization utilities to annotate frames with
detected regions, extracted values, and confidence scores. Useful for
debugging OCR issues and validating extraction accuracy.

Usage:
    from ocr.debug import annotate_frame, save_debug_output
    from ocr import extract_visible_skills
    import cv2

    frame = cv2.imread("screenshot.png")
    result = extract_visible_skills(frame)

    # Get annotated frame
    annotated = annotate_frame(frame, result)
    cv2.imwrite("debug_annotated.png", annotated)

    # Or save all debug outputs at once
    paths = save_debug_output(frame, result, "debug_output")
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from .types import SkillEntry, SkillOcrResult


# Color definitions (BGR format for OpenCV)
COLOR_LIST_BBOX = (255, 128, 0)     # Blue - list bounding box
COLOR_ROW_BBOX = (0, 255, 0)        # Green - row bounding boxes
COLOR_NAME_ROI = (255, 255, 0)      # Cyan - name ROI
COLOR_COST_ROI = (0, 255, 255)      # Yellow - cost ROI
COLOR_HINT_ROI = (0, 165, 255)      # Orange - hint ROI
COLOR_OBTAINED_ROI = (255, 0, 255)  # Magenta - obtained ROI
COLOR_PLUS_BUTTON = (0, 128, 0)     # Dark green - plus button markers
COLOR_TEXT_BG = (0, 0, 0)           # Black - text background
COLOR_TEXT = (255, 255, 255)        # White - text color
COLOR_CONFIDENCE_HIGH = (0, 255, 0)   # Green - high confidence
COLOR_CONFIDENCE_MED = (0, 255, 255)  # Yellow - medium confidence
COLOR_CONFIDENCE_LOW = (0, 0, 255)    # Red - low confidence

# Line thicknesses
LINE_THICK = 2
LINE_THIN = 1

# Font settings
FONT_FACE = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE_LARGE = 0.6
FONT_SCALE_SMALL = 0.45
FONT_THICKNESS = 1


def _get_confidence_color(confidence: float) -> Tuple[int, int, int]:
    """
    Get color based on confidence level.

    Args:
        confidence: Confidence value (0.0-1.0)

    Returns:
        BGR color tuple
    """
    if confidence >= 0.8:
        return COLOR_CONFIDENCE_HIGH
    elif confidence >= 0.5:
        return COLOR_CONFIDENCE_MED
    else:
        return COLOR_CONFIDENCE_LOW


def _draw_text_with_background(
    frame: np.ndarray,
    text: str,
    pos: Tuple[int, int],
    font_scale: float = FONT_SCALE_SMALL,
    color: Tuple[int, int, int] = COLOR_TEXT,
    bg_color: Tuple[int, int, int] = COLOR_TEXT_BG,
    padding: int = 2
) -> None:
    """
    Draw text with a background rectangle for readability.

    Args:
        frame: BGR image to draw on (modified in place)
        text: Text string to draw
        pos: (x, y) position for bottom-left of text
        font_scale: Font scale factor
        color: Text color (BGR)
        bg_color: Background color (BGR)
        padding: Padding around text
    """
    if not text:
        return

    (text_width, text_height), baseline = cv2.getTextSize(
        text, FONT_FACE, font_scale, FONT_THICKNESS
    )

    x, y = pos

    # Background rectangle
    cv2.rectangle(
        frame,
        (x - padding, y - text_height - padding),
        (x + text_width + padding, y + baseline + padding),
        bg_color,
        cv2.FILLED
    )

    # Text
    cv2.putText(
        frame, text, (x, y),
        FONT_FACE, font_scale, color, FONT_THICKNESS, cv2.LINE_AA
    )


def _draw_bbox(
    frame: np.ndarray,
    bbox: Tuple[int, int, int, int],
    color: Tuple[int, int, int],
    thickness: int = LINE_THIN,
    label: Optional[str] = None
) -> None:
    """
    Draw a bounding box on the frame.

    Args:
        frame: BGR image to draw on (modified in place)
        bbox: Bounding box as (x, y, w, h)
        color: Line color (BGR)
        thickness: Line thickness
        label: Optional label to draw above the bbox
    """
    if bbox is None:
        return

    x, y, w, h = bbox
    cv2.rectangle(frame, (x, y), (x + w, y + h), color, thickness)

    if label:
        _draw_text_with_background(
            frame, label, (x, y - 5),
            font_scale=FONT_SCALE_SMALL, color=color
        )


def _draw_list_bbox(
    frame: np.ndarray,
    meta: Dict[str, Any]
) -> None:
    """
    Draw the skill list bounding box on the frame.

    Args:
        frame: BGR image to draw on (modified in place)
        meta: Result metadata containing list_bbox
    """
    list_bbox = meta.get("list_bbox")
    if list_bbox is None:
        return

    x1, y1, x2, y2 = list_bbox
    w = x2 - x1
    h = y2 - y1
    bbox = (x1, y1, w, h)

    confidence = meta.get("layout_confidence", 0)
    label = f"List ({confidence:.0%})"

    _draw_bbox(frame, bbox, COLOR_LIST_BBOX, LINE_THICK, label)


def _draw_plus_buttons(
    frame: np.ndarray,
    meta: Dict[str, Any]
) -> None:
    """
    Draw plus button markers on the frame.

    Note: Plus buttons are stored in layout.plus_buttons, not directly in meta.
    This function expects plus_buttons_count in meta as an indicator.

    Args:
        frame: BGR image to draw on (modified in place)
        meta: Result metadata
    """
    # Plus buttons aren't stored in meta directly, just count
    # We draw circles at approximate positions based on row bboxes
    pass


def _draw_skill_rows(
    frame: np.ndarray,
    skills: List[SkillEntry]
) -> None:
    """
    Draw skill row bounding boxes and their sub-ROIs.

    Args:
        frame: BGR image to draw on (modified in place)
        skills: List of SkillEntry objects with bbox information
    """
    for idx, skill in enumerate(skills):
        bboxes = skill.bboxes
        confidences = skill.confidence

        # Draw row bbox
        row_bbox = bboxes.get("row")
        if row_bbox:
            _draw_bbox(frame, row_bbox, COLOR_ROW_BBOX, LINE_THIN, f"Row {idx}")

        # Draw sub-ROIs with different colors
        roi_configs = [
            ("name", COLOR_NAME_ROI, "N"),
            ("cost", COLOR_COST_ROI, "C"),
            ("hint", COLOR_HINT_ROI, "H"),
            ("obtained", COLOR_OBTAINED_ROI, "O"),
        ]

        for roi_name, color, prefix in roi_configs:
            roi = bboxes.get(roi_name)
            if roi:
                _draw_bbox(frame, roi, color, LINE_THIN)


def _draw_extracted_values(
    frame: np.ndarray,
    skills: List[SkillEntry]
) -> None:
    """
    Draw extracted values and confidence scores near each row.

    Args:
        frame: BGR image to draw on (modified in place)
        skills: List of SkillEntry objects
    """
    for idx, skill in enumerate(skills):
        row_bbox = skill.bboxes.get("row")
        if row_bbox is None:
            continue

        x, y, w, h = row_bbox

        # Build info lines
        lines = []

        # Skill name (truncated if too long)
        name = skill.canonical_name or skill.name_norm or skill.name_raw
        if name:
            name_display = name[:25] + "..." if len(name) > 25 else name
            name_conf = skill.confidence.get("name", 0)
            match_conf = skill.confidence.get("match", 0)
            if skill.skill_id:
                lines.append(f"Name: {name_display} ({match_conf:.0%})")
            else:
                lines.append(f"Name: {name_display} ({name_conf:.0%})")

        # Cost
        if skill.cost is not None:
            cost_conf = skill.confidence.get("cost", 0)
            lines.append(f"Cost: {skill.cost} ({cost_conf:.0%})")

        # Hint
        if skill.hint_level is not None:
            hint_conf = skill.confidence.get("hint", 0)
            discount = skill.discount_percent or 0
            lines.append(f"Hint: Lv{skill.hint_level} -{discount}% ({hint_conf:.0%})")

        # Obtained
        if skill.obtained:
            obt_conf = skill.confidence.get("obtained", 0)
            lines.append(f"Obtained ({obt_conf:.0%})")

        # Draw lines to the right of the row
        text_x = x + w + 10
        text_y = y + 15

        for line in lines:
            # Determine color based on confidence
            conf_value = 0.8  # Default
            if "(" in line and "%" in line:
                try:
                    conf_str = line.split("(")[-1].rstrip("%)")
                    conf_value = float(conf_str) / 100
                except (ValueError, IndexError):
                    pass

            color = _get_confidence_color(conf_value)
            _draw_text_with_background(frame, line, (text_x, text_y), color=color)
            text_y += 18


def _draw_meta_info(
    frame: np.ndarray,
    result: SkillOcrResult
) -> None:
    """
    Draw metadata information at the top of the frame.

    Args:
        frame: BGR image to draw on (modified in place)
        result: SkillOcrResult with metadata
    """
    meta = result.meta
    height, width = frame.shape[:2]

    # Build meta info lines
    lines = []

    platform = meta.get("source", "unknown")
    scale = meta.get("scale", 1.0)
    timing = meta.get("timing", 0)
    rows = meta.get("rows_detected", 0)
    skill_points = result.skill_points_available

    lines.append(f"Platform: {platform} | Scale: {scale:.2f} | Time: {timing:.3f}s")
    lines.append(f"Rows: {rows} | Skills: {len(result.skills)}")

    if skill_points is not None:
        sp_conf = meta.get("skill_points_confidence", 0)
        lines.append(f"Skill Points: {skill_points} ({sp_conf:.0%})")

    if "warning" in meta:
        lines.append(f"Warning: {meta['warning']}")

    if "error" in meta:
        lines.append(f"Error: {meta['error']}")

    # Draw lines at top-left
    text_x = 10
    text_y = 20

    for line in lines:
        _draw_text_with_background(
            frame, line, (text_x, text_y),
            font_scale=FONT_SCALE_LARGE, color=COLOR_TEXT
        )
        text_y += 25


def annotate_frame(
    frame: np.ndarray,
    result: SkillOcrResult,
    show_rois: bool = True,
    show_values: bool = True,
    show_meta: bool = True
) -> np.ndarray:
    """
    Create an annotated copy of the frame with debug visualizations.

    Draws the following on the frame:
    - List bounding box (blue)
    - Row bounding boxes (green)
    - Sub-ROIs for each field (cyan, yellow, orange, magenta)
    - Extracted text and confidence scores
    - Metadata summary at top

    Args:
        frame: BGR image (numpy array) - not modified
        result: SkillOcrResult from extraction
        show_rois: Whether to draw ROI bounding boxes
        show_values: Whether to draw extracted values and confidences
        show_meta: Whether to draw metadata at top

    Returns:
        Annotated copy of the frame (BGR numpy array)
    """
    if frame is None or frame.size == 0:
        return np.zeros((100, 400, 3), dtype=np.uint8)

    # Create a copy to avoid modifying the original
    annotated = frame.copy()

    # Draw list bounding box
    _draw_list_bbox(annotated, result.meta)

    if show_rois:
        # Draw skill row bboxes and sub-ROIs
        _draw_skill_rows(annotated, result.skills)

    if show_values:
        # Draw extracted values with confidence
        _draw_extracted_values(annotated, result.skills)

    if show_meta:
        # Draw metadata info at top
        _draw_meta_info(annotated, result)

    return annotated


def save_debug_output(
    frame: np.ndarray,
    result: SkillOcrResult,
    output_path: str,
    save_annotated: bool = True,
    save_summary: bool = True
) -> Dict[str, str]:
    """
    Save debug outputs including annotated frame and text summary.

    Creates the output directory if it doesn't exist and saves:
    - Annotated frame image (annotated.png)
    - Text summary with all extracted values (summary.txt)

    Args:
        frame: BGR image (numpy array)
        result: SkillOcrResult from extraction
        output_path: Directory path for output files
        save_annotated: Whether to save annotated image
        save_summary: Whether to save text summary

    Returns:
        Dict mapping output type to file path:
        - "annotated": Path to annotated image
        - "summary": Path to summary text file
    """
    paths: Dict[str, str] = {}

    # Create output directory
    output_dir = Path(output_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save annotated frame
    if save_annotated:
        annotated = annotate_frame(frame, result)
        annotated_path = output_dir / "annotated.png"
        cv2.imwrite(str(annotated_path), annotated)
        paths["annotated"] = str(annotated_path)

    # Save text summary
    if save_summary:
        summary_lines = _generate_summary(result)
        summary_path = output_dir / "summary.txt"
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write("\n".join(summary_lines))
        paths["summary"] = str(summary_path)

    return paths


def _generate_summary(result: SkillOcrResult) -> List[str]:
    """
    Generate a text summary of the OCR results.

    Args:
        result: SkillOcrResult from extraction

    Returns:
        List of summary lines
    """
    lines = []

    # Header
    lines.append("=" * 60)
    lines.append("OCR Extraction Summary")
    lines.append("=" * 60)
    lines.append("")

    # Metadata
    meta = result.meta
    lines.append("Metadata:")
    lines.append(f"  Platform: {meta.get('source', 'unknown')}")
    lines.append(f"  Scale: {meta.get('scale', 1.0):.2f}")
    lines.append(f"  Timing: {meta.get('timing', 0):.3f}s")
    lines.append(f"  Frame shape: {meta.get('frame_shape', 'unknown')}")
    lines.append(f"  Layout confidence: {meta.get('layout_confidence', 0):.2%}")
    lines.append(f"  Rows detected: {meta.get('rows_detected', 0)}")
    lines.append(f"  Plus buttons: {meta.get('plus_buttons_count', 0)}")

    if result.skill_points_available is not None:
        sp_conf = meta.get("skill_points_confidence", 0)
        lines.append(f"  Skill points: {result.skill_points_available} ({sp_conf:.2%})")

    if "warning" in meta:
        lines.append(f"  Warning: {meta['warning']}")

    if "error" in meta:
        lines.append(f"  Error: {meta['error']}")

    lines.append("")

    # Skills
    lines.append("-" * 60)
    lines.append(f"Extracted Skills ({len(result.skills)} total)")
    lines.append("-" * 60)

    for idx, skill in enumerate(result.skills):
        lines.append("")
        lines.append(f"[Row {idx}]")

        # Name
        if skill.canonical_name:
            lines.append(f"  Name: {skill.canonical_name} (ID: {skill.skill_id})")
            lines.append(f"    Match confidence: {skill.confidence.get('match', 0):.2%}")
        elif skill.name_norm:
            lines.append(f"  Name (raw): {skill.name_raw}")
            lines.append(f"  Name (normalized): {skill.name_norm}")
            lines.append(f"    OCR confidence: {skill.confidence.get('name', 0):.2%}")
        else:
            lines.append("  Name: (not detected)")

        # Cost
        if skill.cost is not None:
            lines.append(f"  Cost: {skill.cost}")
            lines.append(f"    Confidence: {skill.confidence.get('cost', 0):.2%}")
        else:
            lines.append("  Cost: (not detected)")

        # Hint
        if skill.hint_level is not None:
            discount = skill.discount_percent or 0
            lines.append(f"  Hint: Level {skill.hint_level} (-{discount}%)")
            lines.append(f"    Confidence: {skill.confidence.get('hint', 0):.2%}")
        else:
            lines.append("  Hint: (none)")

        # Obtained
        lines.append(f"  Obtained: {'Yes' if skill.obtained else 'No'}")
        if skill.obtained:
            lines.append(f"    Confidence: {skill.confidence.get('obtained', 0):.2%}")

    lines.append("")
    lines.append("=" * 60)

    return lines


def dump_row_crops(
    frame: np.ndarray,
    result: SkillOcrResult,
    output_dir: str
) -> List[str]:
    """
    Save individual row crop images for debugging OCR issues.

    Saves each detected row as a separate image file, along with
    the individual sub-ROIs (name, cost, hint, obtained).

    Args:
        frame: BGR image (numpy array)
        result: SkillOcrResult from extraction
        output_dir: Directory path for output files

    Returns:
        List of saved file paths
    """
    paths: List[str] = []

    if frame is None or frame.size == 0:
        return paths

    # Create output directory
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    for idx, skill in enumerate(result.skills):
        bboxes = skill.bboxes

        # Save full row crop
        row_bbox = bboxes.get("row")
        if row_bbox:
            crop = _get_crop(frame, row_bbox)
            if crop is not None and crop.size > 0:
                row_path = out_path / f"row_{idx:02d}_full.png"
                cv2.imwrite(str(row_path), crop)
                paths.append(str(row_path))

        # Save sub-ROI crops
        roi_names = ["name", "cost", "hint", "obtained"]
        for roi_name in roi_names:
            roi = bboxes.get(roi_name)
            if roi:
                crop = _get_crop(frame, roi)
                if crop is not None and crop.size > 0:
                    roi_path = out_path / f"row_{idx:02d}_{roi_name}.png"
                    cv2.imwrite(str(roi_path), crop)
                    paths.append(str(roi_path))

    return paths


def _get_crop(
    frame: np.ndarray,
    bbox: Tuple[int, int, int, int]
) -> Optional[np.ndarray]:
    """
    Extract a cropped region from the frame.

    Args:
        frame: BGR image (numpy array)
        bbox: Bounding box as (x, y, w, h)

    Returns:
        Cropped image region, or None if invalid
    """
    if frame is None or frame.size == 0:
        return None

    x, y, w, h = bbox

    if w <= 0 or h <= 0:
        return None

    height, width = frame.shape[:2]

    # Clip to frame bounds
    x1 = max(0, x)
    y1 = max(0, y)
    x2 = min(width, x + w)
    y2 = min(height, y + h)

    if x2 <= x1 or y2 <= y1:
        return None

    return frame[y1:y2, x1:x2].copy()


def create_comparison_image(
    frame: np.ndarray,
    result: SkillOcrResult,
    expected_skills: Optional[List[Dict[str, Any]]] = None
) -> np.ndarray:
    """
    Create a side-by-side comparison image for validation.

    Shows the original frame on the left and annotated version on the right.
    If expected_skills are provided, highlights discrepancies.

    Args:
        frame: BGR image (numpy array)
        result: SkillOcrResult from extraction
        expected_skills: Optional list of expected skill data for comparison

    Returns:
        Combined comparison image (BGR numpy array)
    """
    if frame is None or frame.size == 0:
        return np.zeros((100, 800, 3), dtype=np.uint8)

    # Create annotated version
    annotated = annotate_frame(frame, result)

    # Resize both to same height if different
    h1, w1 = frame.shape[:2]
    h2, w2 = annotated.shape[:2]

    if h1 != h2:
        # Scale annotated to match original height
        scale = h1 / h2
        new_w = int(w2 * scale)
        annotated = cv2.resize(annotated, (new_w, h1), interpolation=cv2.INTER_AREA)

    # Concatenate horizontally
    comparison = np.hstack([frame, annotated])

    # Add dividing line
    h, w = comparison.shape[:2]
    cv2.line(comparison, (w1, 0), (w1, h), (128, 128, 128), 2)

    # Add labels
    _draw_text_with_background(comparison, "Original", (10, 30), font_scale=0.7)
    _draw_text_with_background(comparison, "Annotated", (w1 + 10, 30), font_scale=0.7)

    return comparison
