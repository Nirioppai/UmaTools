"""
Evaluation harness for Umamusume skill OCR system.

This module provides utilities to evaluate OCR accuracy against test images
with optional golden expected outputs. Run evaluations to measure accuracy
and track improvements to the OCR pipeline.

Usage:
    # From command line:
    python -m ocr.evaluate tests/fixtures/

    # With specific options:
    python -m ocr.evaluate tests/fixtures/ --quiet --output results.json

    # Programmatically:
    from ocr.evaluate import run_evaluation
    results = run_evaluation("tests/fixtures/")
"""

import argparse
import glob
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from .extractor import extract_visible_skills
from .types import SkillEntry, SkillOcrResult


# Supported image extensions
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".bmp", ".webp")

# Golden output file naming convention
EXPECTED_SUFFIX = "_expected.json"


@dataclass
class EvaluationMetrics:
    """
    Metrics from evaluating a single image.

    Attributes:
        image_path: Path to the evaluated image
        platform_detected: Detected platform (mobile/pc)
        rows_detected: Number of skill rows detected
        skills_matched: Number of skills matched to database
        skills_total: Total skills extracted
        cost_accuracy: Accuracy of cost extraction (if golden data available)
        hint_accuracy: Accuracy of hint detection (if golden data available)
        obtained_accuracy: Accuracy of obtained detection (if golden data available)
        match_accuracy: Accuracy of skill matching (if golden data available)
        processing_time: Time to process the image (seconds)
        errors: List of error messages
    """
    image_path: str
    platform_detected: str = "unknown"
    rows_detected: int = 0
    skills_matched: int = 0
    skills_total: int = 0
    cost_accuracy: Optional[float] = None
    hint_accuracy: Optional[float] = None
    obtained_accuracy: Optional[float] = None
    match_accuracy: Optional[float] = None
    processing_time: float = 0.0
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


@dataclass
class EvaluationResult:
    """
    Complete evaluation result for a test set.

    Attributes:
        total_images: Number of images processed
        successful_images: Number of images processed successfully
        failed_images: Number of images that failed processing
        total_skills: Total skills extracted across all images
        total_matched: Total skills matched to database
        avg_cost_accuracy: Average cost extraction accuracy (where golden data available)
        avg_hint_accuracy: Average hint detection accuracy
        avg_obtained_accuracy: Average obtained detection accuracy
        avg_match_accuracy: Average skill matching accuracy
        avg_processing_time: Average processing time per image
        image_metrics: Per-image metrics
    """
    total_images: int = 0
    successful_images: int = 0
    failed_images: int = 0
    total_skills: int = 0
    total_matched: int = 0
    avg_cost_accuracy: Optional[float] = None
    avg_hint_accuracy: Optional[float] = None
    avg_obtained_accuracy: Optional[float] = None
    avg_match_accuracy: Optional[float] = None
    avg_processing_time: float = 0.0
    image_metrics: List[EvaluationMetrics] = None

    def __post_init__(self):
        if self.image_metrics is None:
            self.image_metrics = []


def _load_expected(image_path: str) -> Optional[Dict[str, Any]]:
    """
    Load expected golden output for an image if it exists.

    Looks for a JSON file with the same name as the image but with
    '_expected.json' suffix.

    Args:
        image_path: Path to the image file

    Returns:
        Expected data dict, or None if not found
    """
    base = os.path.splitext(image_path)[0]
    expected_path = base + EXPECTED_SUFFIX

    if not os.path.exists(expected_path):
        return None

    try:
        with open(expected_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def _compare_skills(
    extracted: List[SkillEntry],
    expected: List[Dict[str, Any]],
) -> Tuple[float, float, float, float]:
    """
    Compare extracted skills against expected golden data.

    Returns accuracy metrics for each field type.

    Args:
        extracted: List of extracted SkillEntry objects
        expected: List of expected skill dicts

    Returns:
        Tuple of (cost_accuracy, hint_accuracy, obtained_accuracy, match_accuracy)
        Each is a float 0.0-1.0, or None if no comparisons were made
    """
    if not expected:
        return (None, None, None, None)

    # Match extracted to expected by index (assuming same order)
    n_compare = min(len(extracted), len(expected))
    if n_compare == 0:
        return (None, None, None, None)

    cost_correct = 0
    cost_total = 0
    hint_correct = 0
    hint_total = 0
    obtained_correct = 0
    obtained_total = 0
    match_correct = 0
    match_total = 0

    for i in range(n_compare):
        ext = extracted[i]
        exp = expected[i]

        # Cost comparison
        if "cost" in exp and exp["cost"] is not None:
            cost_total += 1
            if ext.cost == exp["cost"]:
                cost_correct += 1

        # Hint comparison
        if "hint_level" in exp:
            hint_total += 1
            if ext.hint_level == exp.get("hint_level"):
                hint_correct += 1
                # Also check discount if hint matches
                if ext.discount_percent == exp.get("discount_percent"):
                    pass  # Discount is tied to hint level
                else:
                    hint_correct -= 0.5  # Partial credit

        # Obtained comparison
        if "obtained" in exp:
            obtained_total += 1
            if ext.obtained == exp["obtained"]:
                obtained_correct += 1

        # Match comparison (by skill_id or canonical_name)
        if "skill_id" in exp and exp["skill_id"] is not None:
            match_total += 1
            if ext.skill_id == exp["skill_id"]:
                match_correct += 1
        elif "canonical_name" in exp and exp["canonical_name"]:
            match_total += 1
            if ext.canonical_name == exp["canonical_name"]:
                match_correct += 1

    cost_acc = cost_correct / cost_total if cost_total > 0 else None
    hint_acc = hint_correct / hint_total if hint_total > 0 else None
    obtained_acc = obtained_correct / obtained_total if obtained_total > 0 else None
    match_acc = match_correct / match_total if match_total > 0 else None

    return (cost_acc, hint_acc, obtained_acc, match_acc)


def _format_table_row(
    row_idx: int,
    skill: SkillEntry,
) -> str:
    """
    Format a single skill as a table row.

    Args:
        row_idx: Row index
        skill: SkillEntry to format

    Returns:
        Formatted table row string
    """
    name_raw = skill.name_raw[:20] + "..." if len(skill.name_raw) > 23 else skill.name_raw
    matched = skill.canonical_name or "(unmatched)"
    matched = matched[:20] + "..." if len(matched) > 23 else matched
    cost = str(skill.cost) if skill.cost is not None else "-"
    hint = str(skill.hint_level) if skill.hint_level is not None else "-"
    discount = f"{skill.discount_percent}%" if skill.discount_percent else "-"
    obtained = "Yes" if skill.obtained else "No"

    # Confidence summary
    conf_parts = []
    if "name" in skill.confidence:
        conf_parts.append(f"n:{skill.confidence['name']:.0%}")
    if "cost" in skill.confidence:
        conf_parts.append(f"c:{skill.confidence['cost']:.0%}")
    if "match" in skill.confidence:
        conf_parts.append(f"m:{skill.confidence['match']:.0%}")
    conf_str = " ".join(conf_parts) if conf_parts else "-"

    return f"{row_idx:3d} | {name_raw:23s} | {matched:23s} | {cost:5s} | {hint:4s} | {discount:5s} | {obtained:3s} | {conf_str}"


def _print_skill_table(
    skills: List[SkillEntry],
    image_name: str,
) -> None:
    """
    Print a formatted table of extracted skills.

    Args:
        skills: List of SkillEntry objects
        image_name: Name of the source image
    """
    header = f"{'Row':3s} | {'Name (raw)':23s} | {'Matched Name':23s} | {'Cost':5s} | {'Hint':4s} | {'Disc':5s} | {'Obt':3s} | Confidences"
    separator = "-" * len(header)

    print(f"\n{image_name}:")
    print(separator)
    print(header)
    print(separator)

    for idx, skill in enumerate(skills):
        print(_format_table_row(idx, skill))

    print(separator)
    print()


def evaluate_image(
    image_path: str,
    debug: bool = False,
) -> Tuple[SkillOcrResult, EvaluationMetrics]:
    """
    Evaluate OCR on a single image.

    Args:
        image_path: Path to the image file
        debug: Whether to enable debug mode

    Returns:
        Tuple of (SkillOcrResult, EvaluationMetrics)
    """
    metrics = EvaluationMetrics(image_path=image_path)

    # Load image
    frame = cv2.imread(image_path)
    if frame is None:
        metrics.errors.append(f"Failed to load image: {image_path}")
        return (SkillOcrResult(), metrics)

    # Run extraction
    start_time = time.time()
    try:
        result = extract_visible_skills(frame, debug=debug)
        metrics.processing_time = time.time() - start_time
    except Exception as e:
        metrics.errors.append(f"Extraction failed: {str(e)}")
        metrics.processing_time = time.time() - start_time
        return (SkillOcrResult(), metrics)

    # Collect metrics
    metrics.platform_detected = result.meta.get("source", "unknown")
    metrics.rows_detected = result.meta.get("rows_detected", 0)
    metrics.skills_total = len(result.skills)
    metrics.skills_matched = sum(1 for s in result.skills if s.skill_id is not None)

    # Check for errors in result
    if "error" in result.meta:
        metrics.errors.append(result.meta["error"])

    # Load and compare against expected if available
    expected = _load_expected(image_path)
    if expected:
        expected_skills = expected.get("skills", [])
        cost_acc, hint_acc, obt_acc, match_acc = _compare_skills(
            result.skills, expected_skills
        )
        metrics.cost_accuracy = cost_acc
        metrics.hint_accuracy = hint_acc
        metrics.obtained_accuracy = obt_acc
        metrics.match_accuracy = match_acc

    return (result, metrics)


def run_evaluation(
    fixtures_dir: str,
    quiet: bool = False,
    debug: bool = False,
) -> EvaluationResult:
    """
    Run evaluation on all images in a fixtures directory.

    Processes all supported image files in the directory, compares
    against golden expected outputs if available, and returns
    aggregated metrics.

    Args:
        fixtures_dir: Path to directory containing test images
        quiet: If True, suppress per-image output
        debug: If True, generate debug output for each image

    Returns:
        EvaluationResult with aggregated metrics
    """
    result = EvaluationResult()

    # Find all images
    fixtures_path = Path(fixtures_dir)
    if not fixtures_path.exists():
        print(f"Fixtures directory not found: {fixtures_dir}")
        return result

    image_files = []
    for ext in IMAGE_EXTENSIONS:
        image_files.extend(fixtures_path.glob(f"*{ext}"))
        image_files.extend(fixtures_path.glob(f"*{ext.upper()}"))

    # Sort for consistent ordering
    image_files = sorted(set(image_files))

    if not image_files:
        print(f"No images found in {fixtures_dir}")
        return result

    result.total_images = len(image_files)

    if not quiet:
        print(f"\nEvaluating {len(image_files)} images from {fixtures_dir}\n")

    # Process each image
    total_processing_time = 0.0
    cost_accuracies = []
    hint_accuracies = []
    obtained_accuracies = []
    match_accuracies = []

    for image_path in image_files:
        ocr_result, metrics = evaluate_image(str(image_path), debug=debug)

        result.image_metrics.append(metrics)
        total_processing_time += metrics.processing_time
        result.total_skills += metrics.skills_total
        result.total_matched += metrics.skills_matched

        if metrics.errors:
            result.failed_images += 1
        else:
            result.successful_images += 1

        # Collect accuracy metrics
        if metrics.cost_accuracy is not None:
            cost_accuracies.append(metrics.cost_accuracy)
        if metrics.hint_accuracy is not None:
            hint_accuracies.append(metrics.hint_accuracy)
        if metrics.obtained_accuracy is not None:
            obtained_accuracies.append(metrics.obtained_accuracy)
        if metrics.match_accuracy is not None:
            match_accuracies.append(metrics.match_accuracy)

        # Print per-image results
        if not quiet:
            _print_skill_table(ocr_result.skills, image_path.name)

            # Print accuracy if expected data available
            if any([
                metrics.cost_accuracy is not None,
                metrics.hint_accuracy is not None,
                metrics.obtained_accuracy is not None,
                metrics.match_accuracy is not None,
            ]):
                print("  Accuracy vs expected:")
                if metrics.cost_accuracy is not None:
                    print(f"    Cost: {metrics.cost_accuracy:.1%}")
                if metrics.hint_accuracy is not None:
                    print(f"    Hint: {metrics.hint_accuracy:.1%}")
                if metrics.obtained_accuracy is not None:
                    print(f"    Obtained: {metrics.obtained_accuracy:.1%}")
                if metrics.match_accuracy is not None:
                    print(f"    Match: {metrics.match_accuracy:.1%}")
                print()

    # Calculate averages
    result.avg_processing_time = total_processing_time / len(image_files) if image_files else 0

    if cost_accuracies:
        result.avg_cost_accuracy = sum(cost_accuracies) / len(cost_accuracies)
    if hint_accuracies:
        result.avg_hint_accuracy = sum(hint_accuracies) / len(hint_accuracies)
    if obtained_accuracies:
        result.avg_obtained_accuracy = sum(obtained_accuracies) / len(obtained_accuracies)
    if match_accuracies:
        result.avg_match_accuracy = sum(match_accuracies) / len(match_accuracies)

    # Print summary
    if not quiet:
        _print_summary(result)

    return result


def _print_summary(result: EvaluationResult) -> None:
    """
    Print a summary of evaluation results.

    Args:
        result: EvaluationResult to summarize
    """
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)

    print(f"\nImages: {result.successful_images}/{result.total_images} successful")
    if result.failed_images > 0:
        print(f"  ({result.failed_images} failed)")

    print(f"\nSkills: {result.total_skills} extracted, {result.total_matched} matched to database")

    if result.total_skills > 0:
        match_rate = result.total_matched / result.total_skills
        print(f"  Match rate: {match_rate:.1%}")

    print(f"\nProcessing: {result.avg_processing_time:.3f}s average per image")

    # Print accuracy metrics if available
    has_accuracy = any([
        result.avg_cost_accuracy is not None,
        result.avg_hint_accuracy is not None,
        result.avg_obtained_accuracy is not None,
        result.avg_match_accuracy is not None,
    ])

    if has_accuracy:
        print("\nAccuracy (vs golden expected data):")
        if result.avg_cost_accuracy is not None:
            status = "PASS" if result.avg_cost_accuracy >= 0.99 else "FAIL"
            print(f"  Cost:     {result.avg_cost_accuracy:.1%} (target: 99%) [{status}]")
        if result.avg_hint_accuracy is not None:
            status = "PASS" if result.avg_hint_accuracy >= 0.95 else "FAIL"
            print(f"  Hint:     {result.avg_hint_accuracy:.1%} (target: 95%) [{status}]")
        if result.avg_obtained_accuracy is not None:
            status = "PASS" if result.avg_obtained_accuracy >= 0.99 else "FAIL"
            print(f"  Obtained: {result.avg_obtained_accuracy:.1%} (target: 99%) [{status}]")
        if result.avg_match_accuracy is not None:
            status = "PASS" if result.avg_match_accuracy >= 0.90 else "FAIL"
            print(f"  Match:    {result.avg_match_accuracy:.1%} (target: 90%) [{status}]")
    else:
        print("\nNo golden expected data found for accuracy comparison.")
        print("  Create *_expected.json files alongside test images to enable accuracy testing.")

    print("\n" + "=" * 60)


def save_evaluation_results(
    result: EvaluationResult,
    output_path: str,
) -> None:
    """
    Save evaluation results to a JSON file.

    Args:
        result: EvaluationResult to save
        output_path: Path to output JSON file
    """
    # Convert to dict for JSON serialization
    data = {
        "total_images": result.total_images,
        "successful_images": result.successful_images,
        "failed_images": result.failed_images,
        "total_skills": result.total_skills,
        "total_matched": result.total_matched,
        "avg_cost_accuracy": result.avg_cost_accuracy,
        "avg_hint_accuracy": result.avg_hint_accuracy,
        "avg_obtained_accuracy": result.avg_obtained_accuracy,
        "avg_match_accuracy": result.avg_match_accuracy,
        "avg_processing_time": result.avg_processing_time,
        "image_metrics": [
            {
                "image_path": m.image_path,
                "platform_detected": m.platform_detected,
                "rows_detected": m.rows_detected,
                "skills_matched": m.skills_matched,
                "skills_total": m.skills_total,
                "cost_accuracy": m.cost_accuracy,
                "hint_accuracy": m.hint_accuracy,
                "obtained_accuracy": m.obtained_accuracy,
                "match_accuracy": m.match_accuracy,
                "processing_time": m.processing_time,
                "errors": m.errors,
            }
            for m in result.image_metrics
        ],
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def create_expected_template(
    image_path: str,
) -> Dict[str, Any]:
    """
    Create a template expected output file for a test image.

    Runs OCR on the image and creates a template with the extracted
    values that can be manually verified and corrected.

    Args:
        image_path: Path to the image file

    Returns:
        Template dict for expected output
    """
    frame = cv2.imread(image_path)
    if frame is None:
        return {"error": f"Failed to load image: {image_path}"}

    result = extract_visible_skills(frame)

    template = {
        "_comment": "Verify and correct these values manually",
        "platform": result.meta.get("source", "unknown"),
        "skill_points_available": result.skill_points_available,
        "skills": [],
    }

    for skill in result.skills:
        skill_data = {
            "name_raw": skill.name_raw,
            "skill_id": skill.skill_id,
            "canonical_name": skill.canonical_name,
            "cost": skill.cost,
            "hint_level": skill.hint_level,
            "discount_percent": skill.discount_percent,
            "obtained": skill.obtained,
        }
        template["skills"].append(skill_data)

    return template


def main():
    """Command-line entry point."""
    parser = argparse.ArgumentParser(
        description="Evaluate OCR accuracy on test images",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m ocr.evaluate tests/fixtures/
  python -m ocr.evaluate tests/fixtures/ --quiet
  python -m ocr.evaluate tests/fixtures/ --output results.json
  python -m ocr.evaluate tests/fixtures/ --create-templates
        """,
    )

    parser.add_argument(
        "fixtures_dir",
        nargs="?",
        default="tests/fixtures",
        help="Directory containing test images (default: tests/fixtures)",
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress per-image output, only show summary",
    )
    parser.add_argument(
        "--debug", "-d",
        action="store_true",
        help="Generate debug output for each image",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Save results to JSON file",
    )
    parser.add_argument(
        "--create-templates",
        action="store_true",
        help="Create expected output templates for images without them",
    )

    args = parser.parse_args()

    # Handle template creation mode
    if args.create_templates:
        fixtures_path = Path(args.fixtures_dir)
        if not fixtures_path.exists():
            print(f"Fixtures directory not found: {args.fixtures_dir}")
            sys.exit(1)

        image_files = []
        for ext in IMAGE_EXTENSIONS:
            image_files.extend(fixtures_path.glob(f"*{ext}"))
            image_files.extend(fixtures_path.glob(f"*{ext.upper()}"))

        created = 0
        for image_path in sorted(set(image_files)):
            expected_path = str(image_path).rsplit(".", 1)[0] + EXPECTED_SUFFIX
            if os.path.exists(expected_path):
                print(f"Skipping (exists): {expected_path}")
                continue

            template = create_expected_template(str(image_path))
            with open(expected_path, "w", encoding="utf-8") as f:
                json.dump(template, f, indent=2, ensure_ascii=False)
            print(f"Created: {expected_path}")
            created += 1

        print(f"\nCreated {created} template file(s)")
        sys.exit(0)

    # Run evaluation
    result = run_evaluation(args.fixtures_dir, quiet=args.quiet, debug=args.debug)

    # Save results if requested
    if args.output:
        save_evaluation_results(result, args.output)
        print(f"\nResults saved to: {args.output}")

    # Exit with error code if any failures
    if result.failed_images > 0:
        sys.exit(1)

    # Exit with error code if accuracy targets not met
    if result.avg_cost_accuracy is not None and result.avg_cost_accuracy < 0.99:
        sys.exit(1)
    if result.avg_hint_accuracy is not None and result.avg_hint_accuracy < 0.95:
        sys.exit(1)
    if result.avg_obtained_accuracy is not None and result.avg_obtained_accuracy < 0.99:
        sys.exit(1)
    if result.avg_match_accuracy is not None and result.avg_match_accuracy < 0.90:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
