import { alarmCauseForDefType, CAUSE_OPTIONS, DEF_TYPE_ALARM_CAUSE, TYPE_MATRIX } from '@/config/formConfig';

describe('alarmCauseForDefType', () => {
    test('trends are recorded under the Alarm tab cause names', () => {
        expect(alarmCauseForDefType('Progressive')).toEqual({ reason: 'Valid', cause: 'Progressive Deformation Trend' });
        expect(alarmCauseForDefType('Linear Accelerating')).toEqual({ reason: 'Valid', cause: 'Linear Accelerating Trend' });
        expect(alarmCauseForDefType('Linear')).toEqual({ reason: 'Valid', cause: 'Linear Deformation Trend' });
        expect(alarmCauseForDefType('Regressive')).toEqual({ reason: 'Valid', cause: 'Regressive Deformation Trend' });
        expect(alarmCauseForDefType('Failure')).toEqual({ reason: 'Valid', cause: 'Failure Pattern Indication' });
        expect(alarmCauseForDefType('Material Detachment')).toEqual({ reason: 'Valid', cause: 'Material Detachment Indication' });
    });

    test('blast and rainfall alarms are filed as False, as the Alarm tab would', () => {
        expect(alarmCauseForDefType('Blast Event')).toEqual({ reason: 'False', cause: 'Blasting Event' });
        expect(alarmCauseForDefType('Rainfall Event')).toEqual({ reason: 'False', cause: 'Rainfall Event' });
    });

    test('every mapped cause is one the Alarm tab offers', () => {
        const all = [...CAUSE_OPTIONS.Valid, ...CAUSE_OPTIONS.False];
        Object.entries(DEF_TYPE_ALARM_CAUSE).forEach(([type, cause]) => {
            expect(TYPE_MATRIX).toHaveProperty([type]);
            expect(all).toContain(cause);
        });
    });

    test('types with no counterpart pass through as Valid', () => {
        expect(alarmCauseForDefType('Forecast')).toEqual({ reason: 'Valid', cause: 'Forecast' });
    });
});
