"""
Video optimization module for Umamusume skill OCR extraction.

This module provides performance optimizations for video processing:
- Geometry caching: Cache list_bbox and row positions across frames
- Temporal smoothing: Keep most confident readings for stable output
- Scene change detection: Re-run full detection when layout changes

Target performance: 10-30 fps with stable output across frames.

Usage:
    from ocr.video import VideoOptimizer

    optimizer = VideoOptimizer(cache_frames=5)

    # Process video frames
    for frame in video_frames:
        result = optimizer.process_frame(frame)
        for skill in result.skills:
            print(f"{skill.canonical_name}: {skill.cost}")
"""

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from .extractor import extract_visible_skills
from .layout import LayoutInfo, detect_layout
from .types import SkillEntry, SkillOcrResult


# Type alias for bounding box
BBox = Tuple[int, int, int, int]


@dataclass
class CachedGeometry:
    """
    Cached layout geometry for video processing.

    Stores the detected layout information that can be reused across
    consecutive frames without re-detection.

    Attributes:
        layout: LayoutInfo from layout detection
        frame_hash: Hash of the frame region for change detection
        frame_count: Number of frames this cache has been used
        created_at: Timestamp when cache was created
    """
    layout: LayoutInfo
    frame_hash: int = 0
    frame_count: int = 0
    created_at: float = field(default_factory=time.time)


@dataclass
class TemporalValue:
    """
    Tracks a value over time for temporal smoothing.

    Keeps the most confident reading within a window.

    Attributes:
        value: The stored value
        confidence: Confidence score for this value
        frame_count: Number of frames since this value was set
        last_updated: Timestamp of last update
    """
    value: any
    confidence: float = 0.0
    frame_count: int = 0
    last_updated: float = field(default_factory=time.time)


@dataclass
class RowTracker:
    """
    Tracks a skill row across frames for temporal smoothing.

    Maintains the most confident reading for each field.

    Attributes:
        row_index: Index of the row in the list
        name: Most confident skill name reading
        cost: Most confident cost reading
        hint_level: Most confident hint level reading
        discount_percent: Most confident discount reading
        obtained: Most stable obtained status
        skill_id: Matched skill ID
        canonical_name: Matched canonical name
        last_y_position: Last known y position for tracking
    """
    row_index: int
    name: Optional[TemporalValue] = None
    cost: Optional[TemporalValue] = None
    hint_level: Optional[TemporalValue] = None
    discount_percent: Optional[TemporalValue] = None
    obtained: Optional[TemporalValue] = None
    skill_id: Optional[int] = None
    canonical_name: Optional[str] = None
    last_y_position: int = 0


class VideoOptimizer:
    """
    Optimizer for video frame processing with geometry caching.

    Provides performance optimizations for processing consecutive video frames:
    - Caches layout detection results to avoid redundant computation
    - Detects scene changes to trigger re-detection when needed
    - Applies temporal smoothing for stable field values

    Attributes:
        cache_frames: Number of frames to reuse cached geometry
        confidence_threshold: Minimum confidence to accept cached geometry
        scene_change_threshold: Hash difference threshold for scene change

    Example:
        optimizer = VideoOptimizer(cache_frames=5)

        for frame in video_frames:
            result = optimizer.process_frame(frame)
            # result contains smoothed skill data
    """

    def __init__(
        self,
        cache_frames: int = 5,
        confidence_threshold: float = 0.5,
        scene_change_threshold: float = 0.15,
        temporal_window: int = 3,
    ):
        """
        Initialize the video optimizer.

        Args:
            cache_frames: Number of frames to reuse cached geometry before
                          forcing a re-detection. Default 5.
            confidence_threshold: Minimum layout confidence to use cached
                                  geometry. Below this, force re-detection.
            scene_change_threshold: Relative difference threshold (0.0-1.0)
                                    for detecting scene changes. Lower = more
                                    sensitive to changes.
            temporal_window: Number of frames to track for temporal smoothing.
        """
        self.cache_frames = max(1, cache_frames)
        self.confidence_threshold = confidence_threshold
        self.scene_change_threshold = scene_change_threshold
        self.temporal_window = max(1, temporal_window)

        # Cached geometry
        self._cached_geometry: Optional[CachedGeometry] = None

        # Frame tracking
        self._frame_count: int = 0
        self._last_frame_time: float = 0.0
        self._fps_estimate: float = 0.0

        # Row trackers for temporal smoothing
        self._row_trackers: Dict[int, RowTracker] = {}

        # Statistics
        self._stats: Dict[str, int] = {
            "frames_processed": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "scene_changes": 0,
        }

    def reset(self):
        """
        Reset the optimizer state.

        Clears all cached geometry and row trackers.
        """
        self._cached_geometry = None
        self._frame_count = 0
        self._row_trackers.clear()
        self._stats = {
            "frames_processed": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "scene_changes": 0,
        }

    def _compute_frame_hash(self, frame: np.ndarray, region: Optional[BBox] = None) -> int:
        """
        Compute a fast hash of a frame region for change detection.

        Uses downsampled average color values for speed.

        Args:
            frame: BGR image
            region: Optional bounding box (x1, y1, x2, y2) to hash

        Returns:
            Integer hash value
        """
        if frame is None or frame.size == 0:
            return 0

        # Extract region if specified
        if region:
            x1, y1, x2, y2 = region
            h, w = frame.shape[:2]
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                return 0
            roi = frame[y1:y2, x1:x2]
        else:
            roi = frame

        # Downsample to small grid (e.g., 8x8) for fast comparison
        try:
            small = cv2.resize(roi, (8, 8), interpolation=cv2.INTER_AREA)
            # Convert to grayscale and compute hash
            if len(small.shape) == 3:
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            else:
                gray = small
            return hash(gray.tobytes())
        except Exception:
            return 0

    def _detect_scene_change(
        self,
        frame: np.ndarray,
        cached: CachedGeometry
    ) -> bool:
        """
        Detect if a significant scene change has occurred.

        Compares the current frame hash with the cached hash.

        Args:
            frame: Current BGR frame
            cached: Cached geometry with previous frame hash

        Returns:
            True if scene changed, False otherwise
        """
        if cached.layout.list_bbox is None:
            return True

        current_hash = self._compute_frame_hash(frame, cached.layout.list_bbox)

        # Simple hash comparison - any difference counts as change
        # In practice, we rely more on confidence threshold
        return current_hash != cached.frame_hash

    def _should_refresh_geometry(
        self,
        frame: np.ndarray,
        cached: Optional[CachedGeometry]
    ) -> bool:
        """
        Determine if geometry cache should be refreshed.

        Args:
            frame: Current BGR frame
            cached: Current cached geometry (may be None)

        Returns:
            True if geometry should be re-detected
        """
        # No cache - must detect
        if cached is None:
            return True

        # Cache expired
        if cached.frame_count >= self.cache_frames:
            return True

        # Low confidence - re-detect
        if cached.layout.confidence < self.confidence_threshold:
            return True

        # Check for scene change
        if self._detect_scene_change(frame, cached):
            self._stats["scene_changes"] += 1
            return True

        return False

    def _update_geometry_cache(
        self,
        frame: np.ndarray,
        source: str = "auto"
    ) -> Optional[LayoutInfo]:
        """
        Update the geometry cache with fresh detection.

        Args:
            frame: BGR image
            source: Layout source hint

        Returns:
            New LayoutInfo, or None if detection failed
        """
        layout = detect_layout(frame, source)

        if layout is None:
            return None

        # Compute hash for change detection
        frame_hash = self._compute_frame_hash(
            frame,
            layout.list_bbox
        )

        self._cached_geometry = CachedGeometry(
            layout=layout,
            frame_hash=frame_hash,
            frame_count=0,
            created_at=time.time(),
        )

        self._stats["cache_misses"] += 1

        return layout

    def _increment_cache_usage(self):
        """Increment the cache usage counter."""
        if self._cached_geometry is not None:
            self._cached_geometry.frame_count += 1
            self._stats["cache_hits"] += 1

    def _update_row_trackers(self, result: SkillOcrResult):
        """
        Update row trackers with new extraction results.

        Applies temporal smoothing by keeping the most confident
        readings across frames.

        Args:
            result: New extraction result
        """
        current_time = time.time()

        # Age out old trackers
        expired_indices = []
        for idx, tracker in self._row_trackers.items():
            # Check all temporal values and age them
            for field_name in ["name", "cost", "hint_level", "discount_percent", "obtained"]:
                val = getattr(tracker, field_name)
                if val is not None:
                    val.frame_count += 1
                    if val.frame_count > self.temporal_window:
                        setattr(tracker, field_name, None)

            # Mark for removal if all values expired
            if all(getattr(tracker, f) is None for f in
                   ["name", "cost", "hint_level", "discount_percent", "obtained"]):
                expired_indices.append(idx)

        for idx in expired_indices:
            del self._row_trackers[idx]

        # Update trackers with new data
        for skill in result.skills:
            # Find matching tracker by approximate y-position (from row bbox)
            row_bbox = skill.bboxes.get("row")
            if row_bbox is None:
                continue

            row_y = row_bbox[1]  # y1 of row
            row_idx = self._find_or_create_tracker(row_y)
            tracker = self._row_trackers[row_idx]

            # Update fields if new reading is more confident
            self._update_tracker_field(
                tracker, "name",
                skill.name_norm,
                skill.confidence.get("name", 0.0),
                current_time
            )

            self._update_tracker_field(
                tracker, "cost",
                skill.cost,
                skill.confidence.get("cost", 0.0),
                current_time
            )

            self._update_tracker_field(
                tracker, "hint_level",
                skill.hint_level,
                skill.confidence.get("hint", 0.0),
                current_time
            )

            self._update_tracker_field(
                tracker, "discount_percent",
                skill.discount_percent,
                skill.confidence.get("hint", 0.0),
                current_time
            )

            self._update_tracker_field(
                tracker, "obtained",
                skill.obtained,
                skill.confidence.get("obtained", 0.0),
                current_time
            )

            # Update skill ID if matched
            if skill.skill_id is not None:
                tracker.skill_id = skill.skill_id
                tracker.canonical_name = skill.canonical_name

            tracker.last_y_position = row_y

    def _find_or_create_tracker(self, y_position: int) -> int:
        """
        Find existing tracker near y_position or create new one.

        Args:
            y_position: Y coordinate of the row

        Returns:
            Tracker index
        """
        # Tolerance for matching rows across frames
        y_tolerance = 20

        for idx, tracker in self._row_trackers.items():
            if abs(tracker.last_y_position - y_position) < y_tolerance:
                return idx

        # Create new tracker
        new_idx = max(self._row_trackers.keys(), default=-1) + 1
        self._row_trackers[new_idx] = RowTracker(
            row_index=new_idx,
            last_y_position=y_position,
        )
        return new_idx

    def _update_tracker_field(
        self,
        tracker: RowTracker,
        field_name: str,
        value: any,
        confidence: float,
        current_time: float
    ):
        """
        Update a single field in a row tracker if confidence is higher.

        Args:
            tracker: RowTracker to update
            field_name: Name of field to update
            value: New value
            confidence: Confidence of new value
            current_time: Current timestamp
        """
        if value is None:
            return

        current_val = getattr(tracker, field_name)

        if current_val is None or confidence > current_val.confidence:
            setattr(tracker, field_name, TemporalValue(
                value=value,
                confidence=confidence,
                frame_count=0,
                last_updated=current_time,
            ))

    def _apply_temporal_smoothing(self, result: SkillOcrResult) -> SkillOcrResult:
        """
        Apply temporal smoothing to extraction results.

        Replaces low-confidence readings with higher-confidence cached values.
        This provides stable output across frames by keeping the most confident
        reading for each field within the temporal window.

        Args:
            result: Raw extraction result

        Returns:
            Smoothed result with more stable values
        """
        # First update trackers with new readings
        self._update_row_trackers(result)

        # Now apply smoothed values back to the result
        smoothed_skills = []
        for skill in result.skills:
            # Find matching tracker for this skill
            row_bbox = skill.bboxes.get("row")
            if row_bbox is None:
                smoothed_skills.append(skill)
                continue

            row_y = row_bbox[1]
            tracker = self._find_matching_tracker(row_y)

            if tracker is None:
                smoothed_skills.append(skill)
                continue

            # Apply smoothed values to create a new skill entry
            smoothed_skill = self._apply_tracker_to_skill(skill, tracker)
            smoothed_skills.append(smoothed_skill)

        # Return new result with smoothed skills
        return SkillOcrResult(
            skills=smoothed_skills,
            skill_points_available=result.skill_points_available,
            meta={
                **result.meta,
                "temporal_smoothing_applied": True,
                "active_trackers": len(self._row_trackers),
            },
        )

    def _find_matching_tracker(self, y_position: int) -> Optional[RowTracker]:
        """
        Find an existing tracker near the given y position.

        Args:
            y_position: Y coordinate to match

        Returns:
            Matching RowTracker or None
        """
        y_tolerance = 20

        for tracker in self._row_trackers.values():
            if abs(tracker.last_y_position - y_position) < y_tolerance:
                return tracker

        return None

    def _apply_tracker_to_skill(
        self,
        skill: SkillEntry,
        tracker: RowTracker
    ) -> SkillEntry:
        """
        Apply smoothed values from a tracker to a skill entry.

        Uses the higher-confidence value between the current reading
        and the cached value from the tracker.

        Args:
            skill: Current skill entry
            tracker: Row tracker with cached values

        Returns:
            New skill entry with smoothed values
        """
        # Get current values and confidences
        current_cost = skill.cost
        current_cost_conf = skill.confidence.get("cost", 0.0)

        current_hint = skill.hint_level
        current_hint_conf = skill.confidence.get("hint", 0.0)

        current_discount = skill.discount_percent
        current_obtained = skill.obtained
        current_obtained_conf = skill.confidence.get("obtained", 0.0)

        # Apply smoothed values if tracker has higher confidence
        smoothed_cost = current_cost
        smoothed_cost_conf = current_cost_conf
        if tracker.cost is not None and tracker.cost.confidence > current_cost_conf:
            smoothed_cost = tracker.cost.value
            smoothed_cost_conf = tracker.cost.confidence

        smoothed_hint = current_hint
        smoothed_hint_conf = current_hint_conf
        smoothed_discount = current_discount
        if tracker.hint_level is not None and tracker.hint_level.confidence > current_hint_conf:
            smoothed_hint = tracker.hint_level.value
            smoothed_hint_conf = tracker.hint_level.confidence
            # Also use the cached discount if we use cached hint
            if tracker.discount_percent is not None:
                smoothed_discount = tracker.discount_percent.value

        smoothed_obtained = current_obtained
        smoothed_obtained_conf = current_obtained_conf
        if tracker.obtained is not None and tracker.obtained.confidence > current_obtained_conf:
            smoothed_obtained = tracker.obtained.value
            smoothed_obtained_conf = tracker.obtained.confidence

        # Use matched skill ID from tracker if available and current doesn't have one
        smoothed_skill_id = skill.skill_id
        smoothed_canonical_name = skill.canonical_name
        if smoothed_skill_id is None and tracker.skill_id is not None:
            smoothed_skill_id = tracker.skill_id
            smoothed_canonical_name = tracker.canonical_name

        # Build updated confidence dict
        smoothed_confidence = {
            **skill.confidence,
            "cost": smoothed_cost_conf,
            "hint": smoothed_hint_conf,
            "obtained": smoothed_obtained_conf,
        }

        # Create new skill entry with smoothed values
        return SkillEntry(
            name_raw=skill.name_raw,
            name_norm=skill.name_norm,
            skill_id=smoothed_skill_id,
            canonical_name=smoothed_canonical_name,
            cost=smoothed_cost,
            hint_level=smoothed_hint,
            discount_percent=smoothed_discount,
            obtained=smoothed_obtained,
            confidence=smoothed_confidence,
            bboxes=skill.bboxes,
        )

    def _update_fps(self, current_time: float):
        """Update FPS estimate based on frame timing."""
        if self._last_frame_time > 0:
            delta = current_time - self._last_frame_time
            if delta > 0:
                instant_fps = 1.0 / delta
                # Exponential moving average
                alpha = 0.3
                self._fps_estimate = alpha * instant_fps + (1 - alpha) * self._fps_estimate
        self._last_frame_time = current_time

    def process_frame(
        self,
        frame: np.ndarray,
        source: str = "auto",
        force_refresh: bool = False,
    ) -> SkillOcrResult:
        """
        Process a video frame with geometry caching.

        Uses cached layout geometry when possible to improve performance.
        Automatically detects scene changes and refreshes cache as needed.

        Args:
            frame: BGR image (numpy array) from the game
            source: Layout source hint - "auto", "mobile", or "pc"
            force_refresh: If True, force geometry re-detection

        Returns:
            SkillOcrResult with extracted skill data and metadata.
            Meta includes additional video-specific fields:
            - cache_hit: True if geometry was reused from cache
            - fps_estimate: Estimated frames per second
            - cache_age: Number of frames cache has been reused
        """
        current_time = time.time()
        self._update_fps(current_time)
        self._frame_count += 1
        self._stats["frames_processed"] += 1

        # Check if we need fresh geometry
        need_refresh = force_refresh or self._should_refresh_geometry(
            frame,
            self._cached_geometry
        )

        cache_hit = not need_refresh

        if need_refresh:
            # Full detection
            layout = self._update_geometry_cache(frame, source)
            if layout is None:
                # Detection failed - return empty result
                return SkillOcrResult(
                    skills=[],
                    skill_points_available=None,
                    meta={
                        "error": "Layout detection failed",
                        "cache_hit": False,
                        "fps_estimate": self._fps_estimate,
                    }
                )
        else:
            # Use cached geometry
            self._increment_cache_usage()

        # Run full extraction (will use cached layout internally if available)
        result = extract_visible_skills(frame, source)

        # Apply temporal smoothing
        result = self._apply_temporal_smoothing(result)

        # Add video-specific metadata
        result.meta["cache_hit"] = cache_hit
        result.meta["fps_estimate"] = round(self._fps_estimate, 1)
        result.meta["frame_count"] = self._frame_count

        if self._cached_geometry:
            result.meta["cache_age"] = self._cached_geometry.frame_count

        return result

    def get_stats(self) -> Dict[str, any]:
        """
        Get optimizer statistics.

        Returns:
            Dict with processing statistics:
            - frames_processed: Total frames processed
            - cache_hits: Number of times cached geometry was reused
            - cache_misses: Number of times fresh detection was needed
            - scene_changes: Number of detected scene changes
            - cache_hit_rate: Percentage of cache hits
            - fps_estimate: Current FPS estimate
        """
        total = self._stats["cache_hits"] + self._stats["cache_misses"]
        hit_rate = (self._stats["cache_hits"] / total * 100) if total > 0 else 0.0

        return {
            **self._stats,
            "cache_hit_rate": round(hit_rate, 1),
            "fps_estimate": round(self._fps_estimate, 1),
        }

    @property
    def is_initialized(self) -> bool:
        """Check if optimizer has processed at least one frame."""
        return self._cached_geometry is not None

    @property
    def current_layout(self) -> Optional[LayoutInfo]:
        """Get the currently cached layout info."""
        if self._cached_geometry:
            return self._cached_geometry.layout
        return None
