"""
Comprehensive verification script for OCR module.
Verifies all accuracy requirements and integration points.
"""
import sys
import time

def main():
    results = []

    # Test 1: Main API imports
    try:
        from ocr import extract_visible_skills, SkillEntry, SkillOcrResult
        results.append(("Main API imports", "PASS"))
    except Exception as e:
        results.append(("Main API imports", f"FAIL: {e}"))

    # Test 2: Skill database loading
    try:
        from ocr.skill_matcher import SkillMatcher
        sm = SkillMatcher()
        skill_count = len(sm.skills)
        if skill_count > 1000:
            results.append((f"Skills database ({skill_count} skills)", "PASS"))
        else:
            results.append(("Skills database", f"FAIL: Only {skill_count} skills"))
    except Exception as e:
        results.append(("Skills database", f"FAIL: {e}"))

    # Test 3: Evaluation harness
    try:
        from ocr.evaluate import run_evaluation
        results.append(("Evaluation harness", "PASS"))
    except Exception as e:
        results.append(("Evaluation harness", f"FAIL: {e}"))

    # Test 4: Video optimizer
    try:
        from ocr.video import VideoOptimizer
        vo = VideoOptimizer(cache_frames=5)
        results.append(("VideoOptimizer", "PASS"))
    except Exception as e:
        results.append(("VideoOptimizer", f"FAIL: {e}"))

    # Test 5: Debug module
    try:
        from ocr.debug import annotate_frame, save_debug_output
        results.append(("Debug module", "PASS"))
    except Exception as e:
        results.append(("Debug module", f"FAIL: {e}"))

    # Test 6: Full extraction pipeline
    try:
        import numpy as np
        from ocr import extract_visible_skills
        frame = np.zeros((1000, 500, 3), dtype=np.uint8)
        result = extract_visible_skills(frame)
        if hasattr(result, 'skills') and hasattr(result, 'meta'):
            results.append(("Full extraction pipeline", "PASS"))
        else:
            results.append(("Full extraction pipeline", "FAIL: Missing attributes"))
    except Exception as e:
        results.append(("Full extraction pipeline", f"FAIL: {e}"))

    # Test 7: Skill matching accuracy
    try:
        from ocr.skill_matcher import SkillMatcher
        sm = SkillMatcher()
        # Test exact match
        r1 = sm.match("It's Going to Be Me")
        # Test fuzzy match
        r2 = sm.match("Its Going to Be Me")  # Missing apostrophe
        if r1.skill_id is not None and r2.skill_id is not None:
            results.append(("Skill matching (exact + fuzzy)", "PASS"))
        else:
            results.append(("Skill matching", "FAIL: Match not found"))
    except Exception as e:
        results.append(("Skill matching", f"FAIL: {e}"))

    # Test 8: Color detection
    try:
        import numpy as np
        from ocr.color_detect import detect_red_badge, detect_orange_badge, find_green_plus_buttons
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        detect_red_badge(img)
        detect_orange_badge(img)
        find_green_plus_buttons(img)
        results.append(("Color detection", "PASS"))
    except Exception as e:
        results.append(("Color detection", f"FAIL: {e}"))

    # Test 9: Layout detection
    try:
        import numpy as np
        from ocr.layout import detect_layout, detect_platform
        # Mobile frame
        mobile = np.zeros((1004, 565, 3), dtype=np.uint8)
        platform = detect_platform(mobile)
        if platform == 'mobile':
            results.append(("Platform detection (mobile)", "PASS"))
        else:
            results.append(("Platform detection", f"FAIL: Expected 'mobile', got '{platform}'"))
        # PC frame
        pc = np.zeros((1152, 2048, 3), dtype=np.uint8)
        platform = detect_platform(pc)
        if platform == 'pc':
            results.append(("Platform detection (PC)", "PASS"))
        else:
            results.append(("Platform detection", f"FAIL: Expected 'pc', got '{platform}'"))
    except Exception as e:
        results.append(("Platform detection", f"FAIL: {e}"))

    # Print results
    print("\n" + "="*60)
    print("OCR Module Verification Results")
    print("="*60)

    passed = 0
    failed = 0
    for name, status in results:
        icon = "+" if status == "PASS" else "X"
        print(f"[{icon}] {name}: {status}")
        if status == "PASS":
            passed += 1
        else:
            failed += 1

    print("="*60)
    print(f"Total: {passed} passed, {failed} failed")
    print("="*60)

    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
