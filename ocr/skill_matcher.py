"""
Skill name matching against the Umamusume skill database.

Uses RapidFuzz for fuzzy string matching to handle OCR errors and
partial name recognition. Matches against both Japanese (jpname) and
English (enname/name_en) skill names.

Usage:
    from ocr.skill_matcher import SkillMatcher

    matcher = SkillMatcher()
    result = matcher.match("It Going to Be Me")  # OCR'd text with errors
    if result.skill_id:
        print(f"Matched: {result.canonical_name} (score: {result.score})")
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from rapidfuzz import fuzz, process


# Path resolution following api/[...path].py pattern
BASE_DIR = Path(__file__).resolve().parents[1]
ASSETS = BASE_DIR / "assets"
SKILLS_FILE = ASSETS / "skills_all.json"

# Matching configuration from spec
MATCH_THRESHOLD = 80  # Minimum score to consider a match
MATCH_LIMIT = 5  # Number of candidates to consider


def _json_load_bom_tolerant(path: Path) -> list:
    """
    Load JSON allowing for optional UTF-8 BOM.
    Tries utf-8-sig first; falls back to utf-8 for safety.
    """
    try:
        with path.open(encoding="utf-8-sig") as f:
            return json.load(f)
    except json.JSONDecodeError:
        with path.open(encoding="utf-8") as f:
            return json.load(f)


@dataclass
class MatchResult:
    """
    Result of skill name matching.

    Attributes:
        skill_id: Matched skill ID from database, None if no match above threshold
        canonical_name: Canonical skill name if matched, None otherwise
        score: Fuzzy match score (0-100), 0 if no match
        matched_field: Which field was matched ("jpname", "enname", "name_en")
        all_matches: List of (name, score, skill_id) for top candidates
    """
    skill_id: Optional[int] = None
    canonical_name: Optional[str] = None
    score: float = 0.0
    matched_field: Optional[str] = None
    all_matches: List[Tuple[str, float, int]] = None

    def __post_init__(self):
        if self.all_matches is None:
            self.all_matches = []


class SkillMatcher:
    """
    Fuzzy matcher for skill names against the skill database.

    Loads skills from skills_all.json and provides fast fuzzy matching
    using RapidFuzz's token_sort_ratio scorer, which handles word
    reordering common in OCR output.

    Attributes:
        skill_names: List of all skill names (for fuzzy matching)
        name_to_skill: Mapping from skill name to skill data
        skills: Raw skill database loaded from JSON
    """

    def __init__(self, skills_file: Optional[Path] = None):
        """
        Initialize the skill matcher.

        Args:
            skills_file: Path to skills_all.json. Uses default if not specified.

        Raises:
            FileNotFoundError: If skills file doesn't exist
            json.JSONDecodeError: If skills file is invalid JSON
        """
        self._skills_file = skills_file or SKILLS_FILE
        self._skills: List[Dict] = []
        self._name_to_skill: Dict[str, Dict] = {}
        self._skill_names: List[str] = []
        self._name_to_field: Dict[str, str] = {}  # Track which field each name came from

        self._load_skills()

    def _load_skills(self) -> None:
        """Load and index skills from the database file."""
        if not self._skills_file.exists():
            raise FileNotFoundError(
                f"Skills database not found: {self._skills_file}. "
                "Ensure skills_all.json is in the assets directory."
            )

        self._skills = _json_load_bom_tolerant(self._skills_file)

        # Build lookup tables
        for skill in self._skills:
            skill_id = skill.get("id")
            if not skill_id:
                continue

            # Index by all available name fields
            name_fields = [
                ("jpname", skill.get("jpname")),
                ("enname", skill.get("enname")),
                ("name_en", skill.get("name_en")),
            ]

            for field_name, name in name_fields:
                if name and isinstance(name, str) and name.strip():
                    clean_name = name.strip()
                    # Only add if not already present (prefer earlier fields)
                    if clean_name not in self._name_to_skill:
                        self._name_to_skill[clean_name] = skill
                        self._skill_names.append(clean_name)
                        self._name_to_field[clean_name] = field_name

            # Also index gene_version names if present
            gene = skill.get("gene_version")
            if gene:
                gene_id = gene.get("id")
                gene_name_fields = [
                    ("name_en", gene.get("name_en")),
                    ("name_ko", gene.get("name_ko")),
                    ("name_tw", gene.get("name_tw")),
                ]
                for field_name, name in gene_name_fields:
                    if name and isinstance(name, str) and name.strip():
                        clean_name = name.strip()
                        if clean_name not in self._name_to_skill:
                            # Create a modified skill dict for gene version
                            gene_skill = {**skill, "id": gene_id, "_is_gene_version": True}
                            self._name_to_skill[clean_name] = gene_skill
                            self._skill_names.append(clean_name)
                            self._name_to_field[clean_name] = f"gene_{field_name}"

    @property
    def skill_names(self) -> List[str]:
        """List of all indexed skill names."""
        return self._skill_names

    @property
    def skills(self) -> List[Dict]:
        """Raw skill database."""
        return self._skills

    def match(
        self,
        ocr_text: str,
        threshold: float = MATCH_THRESHOLD,
        limit: int = MATCH_LIMIT,
    ) -> MatchResult:
        """
        Match OCR'd text against the skill database.

        Uses RapidFuzz token_sort_ratio scorer for robustness against
        word reordering and OCR errors.

        Args:
            ocr_text: Raw or normalized OCR text to match
            threshold: Minimum score (0-100) to consider a match
            limit: Maximum number of candidates to consider

        Returns:
            MatchResult with skill_id and canonical_name if matched,
            or empty result if no match above threshold.
        """
        if not ocr_text or not ocr_text.strip():
            return MatchResult()

        if not self._skill_names:
            return MatchResult()

        clean_text = ocr_text.strip()

        # Use token_sort_ratio for better handling of word reordering
        matches = process.extract(
            clean_text,
            self._skill_names,
            scorer=fuzz.token_sort_ratio,
            limit=limit,
        )

        if not matches:
            return MatchResult()

        # Build all_matches list with skill IDs
        all_matches = []
        for name, score, _ in matches:
            skill = self._name_to_skill.get(name)
            if skill:
                all_matches.append((name, score, skill.get("id")))

        # Check if top match exceeds threshold
        top_name, top_score, _ = matches[0]
        if top_score < threshold:
            return MatchResult(
                score=top_score,
                all_matches=all_matches,
            )

        # Get skill data for the match
        skill = self._name_to_skill.get(top_name)
        if not skill:
            return MatchResult(
                score=top_score,
                all_matches=all_matches,
            )

        return MatchResult(
            skill_id=skill.get("id"),
            canonical_name=top_name,
            score=top_score,
            matched_field=self._name_to_field.get(top_name),
            all_matches=all_matches,
        )

    def match_batch(
        self,
        texts: List[str],
        threshold: float = MATCH_THRESHOLD,
    ) -> List[MatchResult]:
        """
        Match multiple OCR texts against the skill database.

        Args:
            texts: List of OCR'd texts to match
            threshold: Minimum score to consider a match

        Returns:
            List of MatchResult objects, one per input text
        """
        return [self.match(text, threshold) for text in texts]

    def get_skill_by_id(self, skill_id: int) -> Optional[Dict]:
        """
        Look up a skill by its ID.

        Args:
            skill_id: Skill ID to look up

        Returns:
            Skill dict if found, None otherwise
        """
        for skill in self._skills:
            if skill.get("id") == skill_id:
                return skill
            # Also check gene_version
            gene = skill.get("gene_version")
            if gene and gene.get("id") == skill_id:
                return {**skill, "id": skill_id, "_is_gene_version": True}
        return None

    def get_skill_by_name(self, name: str) -> Optional[Dict]:
        """
        Look up a skill by exact name match.

        Args:
            name: Skill name to look up (case-sensitive)

        Returns:
            Skill dict if found, None otherwise
        """
        return self._name_to_skill.get(name)
