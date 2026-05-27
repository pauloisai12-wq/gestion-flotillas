// Validación de cargas — v2 con odómetro NF + operador texto libre

import { z } from 'zod/v4';

/** Schema base con refinement para odometer/NF consistency */
const baseFuelLoad = z.object({
  vehicleId: z.number().int().positive(),
  /** Operador: el nombre/número siempre como texto. Si matchea, backend liga el FK. */
  operatorEmployee: z.string().trim().min(1).max(50),
  operatorName: z.string().trim().min(1).max(150),
  stationId: z.number().int().positive(),
  liters: z.number().positive().optional().nullable(),
  amount: z.number().positive(),

  /** Odómetro + estado */
  odometer: z.number().min(0).optional().nullable(),
  odometerStatus: z.enum(['OK', 'NF']).default('OK'),

  loadDate: z.string().min(1).optional(),
});

export const fuelLoadSchema = baseFuelLoad.refine(
  (data) => {
    if (data.odometerStatus === 'NF') return data.odometer == null;
    return data.odometer != null && data.odometer >= 0;
  },
  {
    message: 'Si odómetro=NF, no debe enviarse valor. Si OK, el valor es obligatorio.',
    path: ['odometer'],
  },
);

export type FuelLoadInput = z.infer<typeof fuelLoadSchema>;

/** Schema del portal público — mismo, pero añade economicNumber (el operador teclea su unidad) */
export const publicFuelLoadSchema = baseFuelLoad
  .extend({
    vehicleEconomicNumber: z.string().trim().min(1).max(30),
    /** Token CSRF emitido al abrir el form */
    csrfToken: z.string().min(10),
  })
  .omit({ vehicleId: true }) // el portal lo resuelve por economicNumber
  .refine(
    (data) => {
      if (data.odometerStatus === 'NF') return data.odometer == null;
      return data.odometer != null && data.odometer >= 0;
    },
    { message: 'Odómetro inválido para el estado declarado.', path: ['odometer'] },
  );

export type PublicFuelLoadInput = z.infer<typeof publicFuelLoadSchema>;
