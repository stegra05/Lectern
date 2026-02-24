export type TargetSliderConfig = {
    min: number;
    max: number;
    disabled: boolean;
};

export function computeTargetSliderConfig(suggestedCardCount?: number): TargetSliderConfig {
    if (suggestedCardCount === undefined || suggestedCardCount <= 0) {
        // Fallback range so slider is interactive during initial load/estimation
        return { min: 1, max: 50, disabled: false };
    }
    return {
        min: Math.max(1, Math.floor(suggestedCardCount * 0.1)),
        max: Math.max(2, Math.ceil(suggestedCardCount * 1.5)),
        disabled: false,
    };
}
