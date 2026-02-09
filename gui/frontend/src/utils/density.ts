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

    if (pageCount >= 100 && effectiveTarget < 2.0) {
        effectiveTarget = 2.0;
    } else if (pageCount >= 50 && effectiveTarget < 1.8) {
        effectiveTarget = 1.8;
    }

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
