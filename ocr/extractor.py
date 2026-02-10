"""
Main extractor module for Umamusume skill OCR extraction.

This module provides the primary API for extracting skill information from
Umamusume Learn screen screenshots and video frames. It orchestrates all
OCR sub-modules to produce structured skill data.

The extraction pipeline:
    1. Layout Detection - Identifies mobile/PC layout and skill list region
    2. Row Segmentation - Splits the list into individual skill rows
    3. Field OCR - Extracts cost, name, hint badge, and obtained status per row
    4. Skill Matching - Matches OCR names against the skill database

Basic Usage
-----------
    from ocr.extractor import extract_visible_skills
    import cv2

    # Load image (BGR format)
    frame = cv2.imread("screenshot.png")

    # Extract skills
    result = extract_visible_skills(frame)

    for skill in result.skills:
        print(f"{skill.canonical_name or skill.name_raw}: {skill.cost} pts")

    print(f"Platform: {result.meta['source']}")

Advanced Examples
-----------------
    # Example 1: Full extraction with all metadata
    result = extract_visible_skills(frame)

    # Access skill points from top bar
    if result.skill_points_available:
        print(f"Points: {result.skill_points_available}")

    # Check extraction metadata
    print(f"Platform: {result.meta.get('source')}")
    print(f"Rows found: {result.meta.get('rows_detected')}")
    print(f"Process time: {result.meta.get('timing'):.3f}s")

    # Example 2: Process skills with confidence filtering
    for skill in result.skills:
        name_conf = skill.confidence.get("name", 0)
        cost_conf = skill.confidence.get("cost", 0)

        if name_conf < 0.5:
            print(f"Low confidence name: {skill.name_raw}")

        if skill.skill_id:
            print(f"Matched: {skill.canonical_name} (ID: {skill.skill_id})")
        else:
            print(f"Unmatched: {skill.name_raw}")

    # Example 3: Debug mode for troubleshooting OCR issues
    result = extract_visible_skills(frame, debug=True)

    if result.meta.get("debug_paths"):
        paths = result.meta["debug_paths"]
        print(f"Annotated frame: {paths.get('annotated')}")
        print(f"Summary: {paths.get('summary')}")
        print(f"Row crops dir: {paths.get('row_crops_dir')}")

    # Example 4: Batch processing video frames
    cap = cv2.VideoCapture("gameplay.mp4")
    all_skills = []

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        result = extract_visible_skills(frame, source="auto")
        if result.skills and "error" not in result.meta:
            all_skills.extend(result.skills)

    cap.release()

    # Example 5: Integration with optimizer/calculator
    result = extract_visible_skills(frame)

    optimizer_input = {
        "available_points": result.skill_points_available,
        "skills": [
            {
                "id": s.skill_id,
                "name": s.canonical_name or s.name_raw,
                "cost": s.cost,
                "discount": s.discount_percent or 0,
                "owned": s.obtained,
            }
            for s in result.skills
            if s.cost is not None
        ]
    }

Error Handling
--------------
    result = extract_visible_skills(frame)

    # Check for errors
    if "error" in result.meta:
        error = result.meta["error"]
        if "Invalid frame" in error:
            # Handle invalid input
            pass
        elif "Layout detection failed" in error:
            # Handle unrecognized screen layout
            pass

    # Check for warnings (partial extraction)
    if "warning" in result.meta:
        print(f"Warning: {result.meta['warning']}")

Notes
-----
    - Tesseract must be installed and configured for pytesseract
    - Japanese language data (jpn) is required for skill name recognition
    - The extractor is resolution-independent (auto-scales internally)
    - Debug mode creates temporary files; clean up output_dir if needed
"""

import os
import tempfile
import time
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

try:
    import pytesseract
except ImportError:
    pytesseract = None

from .color_detect import detect_red_badge
from .constants import COST_UPSCALE_FACTOR, SKILL_POINTS_CONFIG
from .debug import annotate_frame, dump_row_crops, save_debug_output
from .field_ocr import ocr_cost_digits, ocr_hint_badge, ocr_skill_name
from .layout import detect_layout
from .row_parser import get_roi_crop, segment_rows
from .skill_matcher import SkillMatcher
from .types import SkillEntry, SkillOcrResult


# Singleton skill matcher instance for efficiency
_skill_matcher: Optional[SkillMatcher] = None


def _check_tesseract_available() -> bool:
    """Check if pytesseract is available and configured."""
    if pytesseract is None:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _extract_skill_points_roi(
    frame: np.ndarray,
    platform: str,
) -> Optional[np.ndarray]:
    """
    Extract the region of interest containing skill points from the top bar.

    The skill points display is typically located at the top of the screen,
    showing "Skill Points: XXXX" or similar text with a numeric value.

    Args:
        frame: BGR image (full frame)
        platform: Platform type ("mobile" or "pc")

    Returns:
        Cropped BGR image of skill points region, or None if invalid
    """
    if frame is None or frame.size == 0:
        return None

    height, width = frame.shape[:2]

    # Define the top bar region based on platform
    # Mobile: skill points typically in upper portion, centered
    # PC: skill points typically in upper-left or upper-center
    if platform == "mobile":
        # Mobile: top 12% of screen, center-right area
        y1 = int(height * 0.02)
        y2 = int(height * 0.12)
        x1 = int(width * 0.35)
        x2 = int(width * 0.95)
    else:
        # PC: top 10% of screen, center-left area
        y1 = int(height * 0.02)
        y2 = int(height * 0.10)
        x1 = int(width * 0.20)
        x2 = int(width * 0.60)

    # Ensure valid bounds
    y1 = max(0, y1)
    y2 = min(height, y2)
    x1 = max(0, x1)
    x2 = min(width, x2)

    if y2 <= y1 or x2 <= x1:
        return None

    return frame[y1:y2, x1:x2].copy()


def _preprocess_skill_points_roi(roi: np.ndarray) -> np.ndarray:
    """
    Preprocess the skill points ROI for OCR.

    Uses digit-optimized preprocessing similar to cost OCR.

    Args:
        roi: BGR image of skill points region

    Returns:
        Preprocessed binary image ready for OCR
    """
    if roi is None or roi.size == 0:
        return np.ones((50, 200), dtype=np.uint8) * 255

    # Convert to grayscale
    if len(roi.shape) == 3:
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    else:
        gray = roi

    # Upscale for better OCR accuracy
    h, w = gray.shape[:2]
    factor = COST_UPSCALE_FACTOR
    upscaled = cv2.resize(gray, (w * factor, h * factor), interpolation=cv2.INTER_CUBIC)

    # Apply adaptive threshold
    binary = cv2.adaptiveThreshold(
        upscaled,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,
        2
    )

    # Morphological close to fill gaps in digits
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # Ensure black text on white background
    # Check border pixels
    border_mean = np.mean([
        np.mean(binary[0, :]),
        np.mean(binary[-1, :]),
        np.mean(binary[:, 0]),
        np.mean(binary[:, -1])
    ])
    if border_mean < 128:
        binary = cv2.bitwise_not(binary)

    return binary


def _parse_skill_points(text: str) -> Optional[int]:
    """
    Parse skill points value from OCR text.

    Looks for a sequence of digits (typically 1-9999) representing
    the available skill points.

    Args:
        text: Raw OCR output

    Returns:
        Parsed integer value, or None if not found
    """
    if not text:
        return None

    # Extract all digit sequences
    digits = ''.join(c for c in text if c.isdigit())

    if not digits:
        return None

    try:
        value = int(digits)
        # Valid skill points range (0 to 99999)
        if 0 <= value <= 99999:
            return value
        return None
    except ValueError:
        return None


def _extract_skill_points_from_top_bar(
    frame: np.ndarray,
    platform: str,
) -> Tuple[Optional[int], float]:
    """
    Extract skill points available from the top bar of the screen.

    The skill points are displayed at the top of the Learn screen,
    showing the current available points that can be spent.

    Args:
        frame: BGR image (full frame)
        platform: Platform type ("mobile" or "pc")

    Returns:
        Tuple of (skill_points, confidence):
        - skill_points: Integer value of available skill points, or None if not found
        - confidence: OCR confidence score (0.0-1.0)
    """
    if not _check_tesseract_available():
        return (None, 0.0)

    # Extract the ROI containing skill points
    roi = _extract_skill_points_roi(frame, platform)

    if roi is None or roi.size == 0:
        return (None, 0.0)

    # Preprocess for OCR
    preprocessed = _preprocess_skill_points_roi(roi)

    try:
        # Run OCR with digit whitelist
        data = pytesseract.image_to_data(
            preprocessed,
            config=SKILL_POINTS_CONFIG,
            output_type=pytesseract.Output.DICT
        )

        # Extract text and calculate confidence
        texts = []
        confidences = []

        for i, text in enumerate(data['text']):
            conf = data['conf'][i]
            text = text.strip()

            if text and conf >= 0:
                texts.append(text)
                confidences.append(conf)

        combined_text = ''.join(texts)
        avg_confidence = sum(confidences) / len(confidences) / 100.0 if confidences else 0.0

        # Parse skill points
        skill_points = _parse_skill_points(combined_text)

        if skill_points is not None:
            return (skill_points, avg_confidence)

        # Try fallback with Otsu threshold
        if len(roi.shape) == 3:
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        else:
            gray = roi

        h, w = gray.shape[:2]
        factor = COST_UPSCALE_FACTOR
        upscaled = cv2.resize(gray, (w * factor, h * factor), interpolation=cv2.INTER_CUBIC)
        _, binary = cv2.threshold(upscaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Check polarity
        border_mean = np.mean([
            np.mean(binary[0, :]),
            np.mean(binary[-1, :]),
            np.mean(binary[:, 0]),
            np.mean(binary[:, -1])
        ])
        if border_mean < 128:
            binary = cv2.bitwise_not(binary)

        alt_text = pytesseract.image_to_string(binary, config=SKILL_POINTS_CONFIG).strip()
        alt_points = _parse_skill_points(alt_text)

        if alt_points is not None:
            return (alt_points, 0.5)

        return (None, 0.0)

    except Exception:
        return (None, 0.0)


def _get_skill_matcher() -> SkillMatcher:
    """
    Get or create the singleton SkillMatcher instance.

    Returns:
        SkillMatcher instance
    """
    global _skill_matcher
    if _skill_matcher is None:
        _skill_matcher = SkillMatcher()
    return _skill_matcher


def _extract_skill_from_row(
    frame: np.ndarray,
    row,
    matcher: SkillMatcher,
) -> SkillEntry:
    """
    Extract skill information from a single row.

    Args:
        frame: BGR image (full frame)
        row: RowInfo object with sub-ROI locations
        matcher: SkillMatcher for name matching

    Returns:
        SkillEntry with all extracted fields
    """
    # Initialize default values
    name_raw = ""
    name_norm = ""
    skill_id = None
    canonical_name = None
    cost = None
    hint_level = None
    discount_percent = None
    obtained = False
    confidence = {}
    bboxes = {}

    # Store row bbox
    if row.bbox:
        bboxes["row"] = row.bbox

    # Extract cost from cost_roi
    if row.cost_roi:
        cost_crop = get_roi_crop(frame, row.cost_roi)
        if cost_crop is not None and cost_crop.size > 0:
            cost_result = ocr_cost_digits(cost_crop)
            cost = cost_result.value
            confidence["cost"] = cost_result.confidence
            bboxes["cost"] = row.cost_roi

    # Detect obtained badge from obtained_roi
    if row.obtained_roi:
        obtained_crop = get_roi_crop(frame, row.obtained_roi)
        if obtained_crop is not None and obtained_crop.size > 0:
            found, red_conf, _ = detect_red_badge(obtained_crop)
            obtained = found
            confidence["obtained"] = red_conf
            bboxes["obtained"] = row.obtained_roi

    # Extract hint badge from hint_roi
    if row.hint_roi:
        hint_crop = get_roi_crop(frame, row.hint_roi)
        if hint_crop is not None and hint_crop.size > 0:
            hint_result = ocr_hint_badge(hint_crop)
            if hint_result.badge_found:
                hint_level = hint_result.hint_level
                discount_percent = hint_result.discount_percent
                confidence["hint"] = hint_result.confidence
                bboxes["hint"] = row.hint_roi

    # Extract skill name from name_roi
    if row.name_roi:
        name_crop = get_roi_crop(frame, row.name_roi)
        if name_crop is not None and name_crop.size > 0:
            name_result = ocr_skill_name(name_crop)
            name_raw = name_result.raw
            name_norm = name_result.normalized
            confidence["name"] = name_result.confidence
            bboxes["name"] = row.name_roi

            # Match skill name to database
            if name_norm:
                match_result = matcher.match(name_norm)
                if match_result.skill_id:
                    skill_id = match_result.skill_id
                    canonical_name = match_result.canonical_name
                    confidence["match"] = match_result.score / 100.0

    return SkillEntry(
        name_raw=name_raw,
        name_norm=name_norm,
        skill_id=skill_id,
        canonical_name=canonical_name,
        cost=cost,
        hint_level=hint_level,
        discount_percent=discount_percent,
        obtained=obtained,
        confidence=confidence,
        bboxes=bboxes,
    )


def extract_visible_skills(
    frame: np.ndarray,
    source: str = "auto",
    debug: bool = False,
) -> SkillOcrResult:
    """
    Extract visible skill information from a Learn screen frame.

    This is the main entry point for the OCR extraction pipeline. It:
    1. Detects layout (platform, list bbox, scale)
    2. Segments the list into individual skill rows
    3. Extracts each field (cost, name, hints, obtained) per row
    4. Matches skill names against the database

    Args:
        frame: BGR image (numpy array) from the game. Must be 3-channel color.
               Can be any resolution - the extractor is resolution-independent.
        source: Layout source hint - "auto", "mobile", or "pc".
                "auto" detects based on aspect ratio.
        debug: If True, generates annotated debug output.
               (Debug mode will be fully implemented in a later subtask)

    Returns:
        SkillOcrResult containing:
        - skills: List of SkillEntry objects for each detected skill row
        - skill_points_available: Integer skill points from top bar, or None if not detected
        - meta: Dict with source, scale, list_bbox, timing, frame_shape, etc.
    """
    start_time = time.time()

    # Initialize result with defaults
    result = SkillOcrResult(
        skills=[],
        skill_points_available=None,
        meta={},
    )

    # Validate input frame
    if frame is None or frame.size == 0:
        result.meta["error"] = "Invalid frame: None or empty"
        result.meta["timing"] = time.time() - start_time
        if debug:
            result.meta["debug"] = True
            result.meta["debug_paths"] = {"debug_error": "Cannot generate debug for invalid frame"}
        return result

    if len(frame.shape) != 3:
        result.meta["error"] = "Invalid frame: expected 3-channel color image"
        result.meta["timing"] = time.time() - start_time
        if debug:
            result.meta["debug"] = True
            result.meta["debug_paths"] = {"debug_error": "Cannot generate debug for non-3-channel frame"}
        return result

    height, width, channels = frame.shape
    result.meta["frame_shape"] = (height, width, channels)

    # Detect layout
    layout = detect_layout(frame, source)

    if layout is None:
        result.meta["error"] = "Layout detection failed"
        result.meta["timing"] = time.time() - start_time
        if debug:
            result.meta["debug"] = True
            result.meta["debug_paths"] = _generate_debug_output(frame, result)
        return result

    result.meta["source"] = layout.platform
    result.meta["scale"] = layout.scale
    result.meta["list_bbox"] = layout.list_bbox
    result.meta["layout_confidence"] = layout.confidence
    result.meta["row_height_estimate"] = layout.row_height_estimate
    result.meta["plus_buttons_count"] = len(layout.plus_buttons)

    # Extract skill points from top bar
    skill_points, skill_points_conf = _extract_skill_points_from_top_bar(
        frame,
        layout.platform,
    )
    result.skill_points_available = skill_points
    if skill_points is not None:
        result.meta["skill_points_confidence"] = skill_points_conf

    # If no list bbox found, we can't segment rows
    if layout.list_bbox is None:
        result.meta["warning"] = "No skill list detected"
        result.meta["timing"] = time.time() - start_time
        if debug:
            result.meta["debug"] = True
            result.meta["debug_paths"] = _generate_debug_output(frame, result)
        return result

    # Segment rows
    rows = segment_rows(
        frame,
        layout.list_bbox,
        layout.plus_buttons,
        platform=layout.platform,
    )

    result.meta["rows_detected"] = len(rows)

    if not rows:
        result.meta["warning"] = "No skill rows detected"
        result.meta["timing"] = time.time() - start_time
        if debug:
            result.meta["debug"] = True
            result.meta["debug_paths"] = _generate_debug_output(frame, result)
        return result

    # Get skill matcher
    matcher = _get_skill_matcher()

    # Extract skills from each row
    skills = []
    for row in rows:
        skill_entry = _extract_skill_from_row(frame, row, matcher)
        skills.append(skill_entry)

    result.skills = skills

    # Calculate timing
    end_time = time.time()
    result.meta["timing"] = end_time - start_time

    # Debug mode: generate annotated output and row crops
    if debug:
        result.meta["debug"] = True
        debug_paths = _generate_debug_output(frame, result)
        result.meta["debug_paths"] = debug_paths

    return result


def _generate_debug_output(
    frame: np.ndarray,
    result: SkillOcrResult,
    output_dir: Optional[str] = None,
) -> Dict[str, str]:
    """
    Generate debug output including annotated frame and row crops.

    Creates a debug output directory (either specified or a temp directory)
    and saves:
    - Annotated frame with bboxes and extracted values
    - Text summary of results
    - Individual row crops for debugging OCR issues

    Args:
        frame: BGR image (numpy array)
        result: SkillOcrResult from extraction
        output_dir: Optional directory path for debug output.
                   If None, creates a temp directory.

    Returns:
        Dict mapping output type to file path:
        - "output_dir": Base output directory path
        - "annotated": Path to annotated image
        - "summary": Path to summary text file
        - "row_crops": List of paths to row crop images
    """
    paths: Dict[str, str] = {}

    # Create output directory
    if output_dir is None:
        # Create a temp directory for debug output
        output_dir = tempfile.mkdtemp(prefix="ocr_debug_")

    paths["output_dir"] = output_dir

    try:
        # Save annotated frame and summary
        saved = save_debug_output(frame, result, output_dir)
        if "annotated" in saved:
            paths["annotated"] = saved["annotated"]
        if "summary" in saved:
            paths["summary"] = saved["summary"]

        # Save row crops
        crops_dir = os.path.join(output_dir, "crops")
        crop_paths = dump_row_crops(frame, result, crops_dir)
        if crop_paths:
            paths["row_crops_dir"] = crops_dir
            paths["row_crops_count"] = str(len(crop_paths))

    except Exception:
        # Debug output is non-critical, don't fail the extraction
        paths["debug_error"] = "Failed to generate debug output"

    return paths
