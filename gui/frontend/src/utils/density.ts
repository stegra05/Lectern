export type DensitySummary =
    | {
        mode: 'script';
        ratio: string;
    }
    | {
        mode: 'slides';
        targetPerSlide: string;
        totalEst: number;
        pageCount: number;
    };

type SourceType = 'auto' | 'slides' | 'script';

export function computeDensitySummary(
    densityTarget: number,
    sourceType: SourceType,
    pageCount: number
): DensitySummary {
    const baseTarget = densityTarget;
    let effectiveTarget = baseTarget;

    // Clamping logic removed to give user full control


    if (sourceType === 'script') {
        return {
            mode: 'script',
            ratio: (densityTarget / 1.5).toFixed(1),
        };
    }

    return {
        mode: 'slides',
        targetPerSlide: effectiveTarget.toFixed(1),
        totalEst: Math.max(3, Math.round(pageCount * effectiveTarget)),
        pageCount,
    };
}
