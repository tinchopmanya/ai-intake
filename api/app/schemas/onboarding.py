from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import model_validator

RelationshipMode = Literal["coparenting", "relationship_separation"]
BreakupTimeRange = Literal["lt_2m", "between_2m_1y", "between_1y_3y", "gt_3y"]
ChildrenCountCategory = Literal["none", "one", "two_plus"]
RelationshipGoal = Literal["emotional_recovery", "friendly_close", "open_reconciliation"]
BreakupInitiator = Literal["mutual", "partner", "me"]
CustodyType = Literal[
    "partner_custody_visits",
    "shared_custody",
    "my_custody_partner_visits",
    "undefined",
]
ResponseStyle = Literal[
    "strict_parental",
    "cordial_collaborative",
    "friendly_close",
    "open_reconciliation",
]
PronounType = Literal["el", "ella"]


class OnboardingProfileResponse(BaseModel):
    relationship_mode: RelationshipMode | None = None
    user_name: str | None = None
    user_age: int | None = None
    ex_partner_name: str | None = None
    ex_partner_pronoun: PronounType | None = None
    breakup_time_range: BreakupTimeRange | None = None
    children_count_category: ChildrenCountCategory | None = None
    relationship_goal: RelationshipGoal | None = None
    breakup_initiator: BreakupInitiator | None = None
    custody_type: CustodyType | None = None
    response_style: ResponseStyle | None = None
    country_code: str
    language_code: str
    onboarding_completed: bool


class OnboardingProfileUpdateRequest(BaseModel):
    relationship_mode: RelationshipMode
    user_name: str = Field(min_length=1, max_length=120)
    user_age: int = Field(ge=18, le=120)
    ex_partner_name: str = Field(min_length=1, max_length=120)
    ex_partner_pronoun: PronounType
    breakup_time_range: BreakupTimeRange
    children_count_category: ChildrenCountCategory
    relationship_goal: RelationshipGoal | None = None
    breakup_initiator: BreakupInitiator
    custody_type: CustodyType | None = None
    response_style: ResponseStyle | None = None
    country_code: str = Field(min_length=2, max_length=2)
    language_code: Literal["es", "en", "pt"]

    @model_validator(mode="after")
    def validate_branch_requirements(self) -> "OnboardingProfileUpdateRequest":
        if not self.user_name.strip():
            raise ValueError("user_name_required")
        if not self.ex_partner_name.strip():
            raise ValueError("ex_partner_name_required")

        if self.relationship_mode == "coparenting":
            if self.children_count_category not in {"one", "two_plus"}:
                raise ValueError("children_count_category_required_for_coparenting")
            if self.custody_type is None:
                raise ValueError("custody_type_required_for_parenting_branch")
            if self.response_style is None:
                raise ValueError("response_style_required_for_parenting_branch")
            if self.relationship_goal is not None:
                raise ValueError("relationship_goal_not_allowed_for_coparenting")
            return self

        if self.children_count_category != "none":
            raise ValueError("children_count_category_must_be_none_for_relationship_separation")
        if self.custody_type is not None:
            raise ValueError("custody_type_not_allowed_for_relationship_separation")
        if self.response_style is not None:
            raise ValueError("response_style_not_allowed_for_relationship_separation")
        if self.relationship_goal is None:
            raise ValueError("relationship_goal_required_for_non_parenting_branch")
        return self
