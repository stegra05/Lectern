
import { describe, it, expect } from 'vitest';
import { computeTargetSliderConfig } from '../utils/density';

describe('computeTargetSliderConfig', () => {
    it('disables slider without suggested count', () => {
        expect(computeTargetSliderConfig(undefined)).toEqual({
            min: 1,
            max: 50,
            disabled: false,
        });
    });

    it('builds range around suggested count', () => {
        expect(computeTargetSliderConfig(50)).toEqual({
            min: 5,
            max: 63,
            disabled: false,
        });
    });
});
