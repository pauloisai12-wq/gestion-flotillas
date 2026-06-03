// Archivo: /api/prisma/seed.ts
// Seed v2 — alineado al rediseño de abril 2026

import 'dotenv/config';
import {
  PrismaClient,
  DocumentType,
  AssignmentType,
  UserRole,
  VehicleClassification,
  BudgetKind,
  FuelLoadStatus,
  OdometerStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient(); // DATABASE_URL del .env

// Contraseñas demo: se leen de variables de entorno (SEED_*_PASSWORD). Si no se
// proveen, se genera una aleatoria fuerte (no se hardcodea ninguna débil) y se
// imprime UNA sola vez al final. fromEnv=true => no la eco (el operador ya la sabe).
function resolveSeedPassword(envVar: string): { value: string; fromEnv: boolean } {
  const provided = process.env[envVar];
  if (provided && provided.length > 0) return { value: provided, fromEnv: true };
  return { value: randomBytes(12).toString('base64url'), fromEnv: false };
}

async function main() {
  // El seed crea cuentas con contraseñas demo y reactiva usuarios: jamás debe
  // correr contra producción. Usa `prisma migrate deploy` para desplegar.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed deshabilitado en producción (crea cuentas demo). Usa migraciones, no el seed.');
  }
  console.log('🌱 Seed v2 iniciando...');

  // ============================================
  // 0. TIPOS DE VEHÍCULO + SECTORES
  // ============================================
  console.log('📦 Tipos de vehículo...');
  // upsert por `name` (@unique) -> idempotente: re-correr no duplica ni lanza P2002.
  const vehicleTypeSeed = [
    { name: 'Camión de carga', expectedKmPerLiter: 4.5 },
    { name: 'Camioneta 3.5 ton', expectedKmPerLiter: 8.0 },
    { name: 'Sedán ejecutivo', expectedKmPerLiter: 14.0 },
    { name: 'Van de reparto', expectedKmPerLiter: 10.0 },
    { name: 'Tractocamión', expectedKmPerLiter: 3.0 },
  ];
  const vehicleTypes = await Promise.all(
    vehicleTypeSeed.map((vt) =>
      prisma.vehicleType.upsert({
        where: { name: vt.name },
        update: { expectedKmPerLiter: vt.expectedKmPerLiter },
        create: vt,
      }),
    ),
  );
  console.log(`   ✅ ${vehicleTypes.length} tipos`);

  console.log('🏢 Sectores (catálogo inicial placeholder)...');
  // upsert por `code` (@unique).
  const sectorSeed = [
    { code: 'CENTRO', name: 'Zona Centro' },
    { code: 'NORTE', name: 'Zona Norte' },
    { code: 'SUR', name: 'Zona Sur' },
    { code: 'ORIENTE', name: 'Zona Oriente' },
    { code: 'PONIENTE', name: 'Zona Poniente' },
  ];
  const sectors = await Promise.all(
    sectorSeed.map((s) =>
      prisma.sector.upsert({ where: { code: s.code }, update: { name: s.name }, create: s }),
    ),
  );
  console.log(`   ✅ ${sectors.length} sectores`);

  // ============================================
  // 1. VEHÍCULOS (50) con classification + sector
  // ============================================
  console.log('🚗 Vehículos...');

  const brands: Record<string, string[]> = {
    'Camión de carga': ['Kenworth', 'Freightliner', 'International'],
    'Camioneta 3.5 ton': ['Ford', 'Chevrolet', 'RAM'],
    'Sedán ejecutivo': ['Toyota', 'Nissan', 'Volkswagen'],
    'Van de reparto': ['Mercedes-Benz', 'Ford', 'Nissan'],
    'Tractocamión': ['Kenworth', 'Peterbilt', 'Volvo'],
  };
  const models: Record<string, string[]> = {
    'Camión de carga': ['T680', 'Cascadia', 'LT'],
    'Camioneta 3.5 ton': ['F-350', 'Silverado 3500', '3500'],
    'Sedán ejecutivo': ['Camry', 'Sentra', 'Jetta'],
    'Van de reparto': ['Sprinter', 'Transit', 'NV350'],
    'Tractocamión': ['T880', '579', 'FH'],
  };

  const classifications: VehicleClassification[] = ['POLICIAL', 'ESTATAL', 'VIAL'];
  const vehicles = [];
  let vehicleCount = 0;

  for (const vType of vehicleTypes) {
    const typeBrands = brands[vType.name];
    const typeModels = models[vType.name];
    for (let i = 0; i < 10; i++) {
      vehicleCount++;
      const brand = typeBrands[i % typeBrands.length];
      const model = typeModels[i % typeModels.length];
      const year = 2019 + (i % 5);
      const plate = `FL-${String(vehicleCount).padStart(3, '0')}-${String.fromCharCode(65 + (i % 26))}`;
      const ecoNum = `ECO-${String(vehicleCount).padStart(4, '0')}`;
      const odometer = 15000 + Math.floor(Math.random() * 165000);

      // upsert por `plate` (@unique). El executorId se asigna más abajo y NO se
      // incluye aquí, así re-correr no lo pisa.
      const vehicleData = {
        plate,
        economicNumber: ecoNum,
        vehicleTypeId: vType.id,
        classification: classifications[vehicleCount % 3],
        sectorId: sectors[vehicleCount % sectors.length].id,
        brand,
        model,
        year,
        color: ['Blanco', 'Gris', 'Rojo', 'Azul', 'Negro'][i % 5],
        currentOdometer: odometer,
        status: 'OPERATIVE' as const,
        isActive: true,
      };
      const vehicle = await prisma.vehicle.upsert({
        where: { plate },
        update: vehicleData,
        create: vehicleData,
      });
      vehicles.push(vehicle);
    }
  }
  console.log(`   ✅ ${vehicles.length} vehículos`);

  // ============================================
  // 2. DOCUMENTOS (4 por vehículo: Factura + 3 vigencias)
  // ============================================
  console.log('📄 Documentos...');
  const docTypes: DocumentType[] = ['INVOICE', 'INSURANCE', 'VERIFICATION', 'CIRCULATION_CARD'];
  const now = new Date();
  let docsCreated = 0;

  // Document no tiene clave única natural -> idempotencia por guardia de conteo:
  // solo se generan si aún no existe ninguno (re-correr no duplica).
  if ((await prisma.document.count()) === 0) {
    for (const vehicle of vehicles) {
      for (const docType of docTypes) {
        const random = Math.random();
        let expiresAt: Date;
        if (random < 0.7) {
          expiresAt = new Date(now); expiresAt.setDate(expiresAt.getDate() + 31 + Math.floor(Math.random() * 334));
        } else if (random < 0.9) {
          expiresAt = new Date(now); expiresAt.setDate(expiresAt.getDate() + 1 + Math.floor(Math.random() * 30));
        } else {
          expiresAt = new Date(now); expiresAt.setDate(expiresAt.getDate() - (1 + Math.floor(Math.random() * 60)));
        }
        const issuedAt = new Date(expiresAt); issuedAt.setFullYear(issuedAt.getFullYear() - 1);
        await prisma.document.create({
          data: { vehicleId: vehicle.id, type: docType, issuedAt, expiresAt },
        });
        docsCreated++;
      }
    }
    console.log(`   ✅ ${docsCreated} documentos`);
  } else {
    console.log('   ⏭️  documentos ya existen — omitido (idempotente)');
  }

  // ============================================
  // 3. OPERADORES (30) con employeeNumber
  // ============================================
  console.log('👷 Operadores...');
  const firstNames = ['Carlos','Miguel','José','Juan','Pedro','Luis','Roberto','Fernando','Ricardo','Francisco','Antonio','Manuel','Alejandro','Rafael','Daniel','Sergio','Javier','Arturo','Eduardo','Raúl','Héctor','Óscar','Gustavo','Enrique','Alberto','Jorge','Armando','Guillermo','Adrián','Martín'];
  const lastNames  = ['García','Hernández','López','Martínez','González','Rodríguez','Pérez','Sánchez','Ramírez','Torres','Flores','Rivera','Gómez','Díaz','Cruz','Morales','Reyes','Gutiérrez','Ortiz','Ramos','Vargas','Castillo','Jiménez','Moreno','Romero','Álvarez','Ruiz','Mendoza','Aguilar','Medina'];

  const operators = [];
  for (let i = 0; i < 30; i++) {
    const licExpiry = new Date(now);
    if (i < 3) licExpiry.setDate(licExpiry.getDate() + Math.floor(Math.random() * 30));
    else licExpiry.setMonth(licExpiry.getMonth() + 6 + Math.floor(Math.random() * 24));

    // upsert por `employeeNumber` (@unique, determinista EMP-0000X).
    const employeeNumber = `EMP-${String(i + 1).padStart(5, '0')}`;
    const opData = {
      employeeNumber,
      fullName: `${firstNames[i]} ${lastNames[i]}`,
      licenseNumber: `LIC-${String(i + 1).padStart(6, '0')}`,
      licenseType: ['A', 'B', 'C', 'D', 'E'][i % 5],
      licenseExpiresAt: licExpiry,
      phone: `55${String(1000 + i).padStart(4, '0')}${String(Math.floor(Math.random() * 9000) + 1000)}`,
      email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@flotillas.com`,
    };
    const operator = await prisma.operator.upsert({
      where: { employeeNumber },
      update: opData,
      create: opData,
    });
    operators.push(operator);
  }
  console.log(`   ✅ ${operators.length} operadores`);

  // ============================================
  // 4. ASIGNACIONES (primeros 30 vehículos ↔ operadores)
  // ============================================
  console.log('🔗 Asignaciones...');
  // VehicleAssignment no tiene clave única natural -> guardia por conteo.
  if ((await prisma.vehicleAssignment.count()) === 0) {
    for (let i = 0; i < 30; i++) {
      await prisma.vehicleAssignment.create({
        data: {
          vehicleId: vehicles[i].id,
          operatorId: operators[i].id,
          type: i < 20 ? 'FIXED' : 'ROTATIVE',
          startDate: new Date(now.getFullYear(), 0, 1),
          endDate: null,
        },
      });
    }
    console.log('   ✅ 30 asignaciones');
  } else {
    console.log('   ⏭️  asignaciones ya existen — omitido (idempotente)');
  }

  // ============================================
  // 5. GASOLINERAS — con RFC, razón social, email, phone, address
  // ============================================
  console.log('⛽ Gasolineras...');

  const stationsData = [
    { rfc: 'GGC101010ABC', legalName: 'Grupo Gasolinero del Centro S.A. de C.V.', email: 'facturacion@ggcentro.mx', phone: '5511223344', address: 'Av. Reforma 100, CDMX' },
    { rfc: 'CDG020304DEF', legalName: 'Combustibles del Golfo S.A. de C.V.', email: 'contacto@cdgolfo.mx', phone: '9988776655', address: 'Blvd. Costero 200, Veracruz' },
    { rfc: 'ESN030405GHI', legalName: 'Estaciones de Servicio Nacional S.A. de C.V.', email: 'admin@esnacional.mx', phone: '5500110022', address: 'Periférico Sur 1500, CDMX' },
    { rfc: 'PTD040506JKL', legalName: 'Petro-7 Distribuidora S.A. de C.V.', email: 'facturas@petro7.mx', phone: '3344556677', address: 'Av. Vallarta 500, Guadalajara' },
    { rfc: 'GUP050607MNO', legalName: 'Gasolineras Unidas del Pacífico S.A. de C.V.', email: 'ventas@gup.mx', phone: '6677889900', address: 'Malecón 200, Mazatlán' },
    { rfc: 'REN060708PQR', legalName: 'Red de Estaciones del Norte S.A. de C.V.', email: 'contacto@renorte.mx', phone: '8112233445', address: 'Constitución 300, Monterrey' },
    { rfc: 'CLB070809STU', legalName: 'Combustibles y Lubricantes del Bajío S.A. de C.V.', email: 'info@clbajio.mx', phone: '4422334455', address: 'Av. 5 de Febrero 400, Querétaro' },
    { rfc: 'GEP080910VWX', legalName: 'Grupo Energético Peninsular S.A. de C.V.', email: 'atencion@gepeninsular.mx', phone: '9993334455', address: 'Paseo Montejo 150, Mérida' },
    { rfc: 'ESV091011YZA', legalName: 'Estaciones de Servicio del Valle S.A. de C.V.', email: 'contacto@esvalle.mx', phone: '7221234567', address: 'Tollocan 1200, Toluca' },
    { rfc: 'DCS101112BCD', legalName: 'Distribuidora de Combustibles del Sureste S.A. de C.V.', email: 'ventas@dcsureste.mx', phone: '9613344556', address: 'Central Ote 450, Tuxtla' },
  ];

  const stations = [];
  for (const s of stationsData) {
    // upsert por `rfc` (@unique).
    const station = await prisma.approvedStation.upsert({
      where: { rfc: s.rfc },
      update: { ...s, isActive: true },
      create: { ...s, isActive: true },
    });
    stations.push(station);
  }

  const unapprovedData = {
    rfc: 'XAXX010101000',
    legalName: 'Gasolinera Independiente No Autorizada',
    email: 'sinregistro@desconocido.mx',
    phone: '0000000000',
    address: 'Desconocida',
    isActive: false,
  };
  const unapprovedStation = await prisma.approvedStation.upsert({
    where: { rfc: unapprovedData.rfc },
    update: unapprovedData,
    create: unapprovedData,
  });
  console.log(`   ✅ ${stations.length + 1} gasolineras`);

  // ============================================
  // 6. TALLERES (10) con mismo contrato fiscal
  // ============================================
  console.log('🔧 Talleres certificados...');
  const workshopsData = [
    { rfc: 'TME010101AAA', legalName: 'Taller Mecánico Especializado S.A. de C.V.', email: 'servicio@tme.mx', phone: '5599887766', address: 'Av. Industria 100, CDMX' },
    { rfc: 'CAM020202BBB', legalName: 'Camiones y Motores del Norte S.A. de C.V.', email: 'recepcion@camnorte.mx', phone: '8112223344', address: 'Libramiento Norte 50, Monterrey' },
    { rfc: 'SSV030303CCC', legalName: 'Servicio Automotriz del Valle S.A. de C.V.', email: 'admin@ssvalle.mx', phone: '7223344556', address: 'Blvd. Valle 200, Toluca' },
    { rfc: 'DTR040404DDD', legalName: 'Diesel Truck Repair S.A. de C.V.', email: 'cotizar@dtrepair.mx', phone: '3312345678', address: 'Periférico 1000, Guadalajara' },
    { rfc: 'MAB050505EEE', legalName: 'Mecánica Automotriz del Bajío S.A. de C.V.', email: 'agenda@mabajio.mx', phone: '4427654321', address: 'Av. Tecnológico 50, Querétaro' },
    { rfc: 'HMR060606FFF', legalName: 'Hermanos Martínez Refacciones S.A. de C.V.', email: 'ventas@hmrefacciones.mx', phone: '5566778899', address: 'Calz. Guadalupe 200, CDMX' },
    { rfc: 'ATL070707GGG', legalName: 'Atlantic Truck Services S.A. de C.V.', email: 'service@atlantic-truck.mx', phone: '9991122334', address: 'Costera 500, Veracruz' },
    { rfc: 'PRS080808HHH', legalName: 'Precisión Automotriz Sureste S.A. de C.V.', email: 'contacto@prsureste.mx', phone: '9987654321', address: 'Av. Reforma 300, Mérida' },
    { rfc: 'TCN090909III', legalName: 'Talleres Certificados del Norte S.A. de C.V.', email: 'info@tcnorte.mx', phone: '6622334455', address: 'Blvd. Kino 800, Hermosillo' },
    { rfc: 'RSV101010JJJ', legalName: 'Rapid Service Vehicular S.A. de C.V.', email: 'rapid@rsvehicular.mx', phone: '5544332211', address: 'Av. Central 150, CDMX' },
  ];
  const workshops = [];
  for (const w of workshopsData) {
    // upsert por `rfc` (@unique).
    workshops.push(
      await prisma.workshop.upsert({
        where: { rfc: w.rfc },
        update: { ...w, isActive: true },
        create: { ...w, isActive: true },
      }),
    );
  }
  console.log(`   ✅ ${workshops.length} talleres`);

  // ============================================
  // 7. PRESUPUESTOS — mes actual + anterior (para rollover)
  // ============================================
  console.log('💰 Presupuestos (FUEL + MAINTENANCE) — mes anterior cerrado + mes actual...');

  const thisMonth = now.getMonth() + 1;
  const thisYear = now.getFullYear();
  const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
  const lastYear = thisMonth === 1 ? thisYear - 1 : thisYear;

  for (const vehicle of vehicles) {
    // upsert por la clave compuesta @@unique([vehicleId, kind, year, month]).
    // --- MES ANTERIOR (cerrado, con remanente simulado) ---
    const baseLast = 10000;
    const spentLast = Math.round(baseLast * (0.4 + Math.random() * 0.5) * 100) / 100; // 40-90% gastado
    const remainderLast = Math.max(0, baseLast - spentLast);

    const lastFuel = {
      vehicleId: vehicle.id, kind: BudgetKind.FUEL,
      year: lastYear, month: lastMonth,
      baseAmount: baseLast, rolloverIn: 0, spentAmount: spentLast,
      isClosed: true, closedAt: new Date(thisYear, thisMonth - 1, 1, 0, 5),
    };
    await prisma.vehicleBudget.upsert({
      where: { vehicleId_kind_year_month: { vehicleId: vehicle.id, kind: BudgetKind.FUEL, year: lastYear, month: lastMonth } },
      update: lastFuel,
      create: lastFuel,
    });

    // --- MES ACTUAL — rollover del anterior ya aplicado ---
    const spentPct = Math.random();
    let spent = 0;
    let cutoff = false;
    const baseNow = 10000;
    if (spentPct < 0.7) spent = Math.round(baseNow * Math.random() * 0.5 * 100) / 100;
    else if (spentPct < 0.9) spent = Math.round(baseNow * (0.75 + Math.random() * 0.15) * 100) / 100;
    else { spent = Math.round(baseNow * (1 + Math.random() * 0.1) * 100) / 100; cutoff = true; }

    const nowFuel = {
      vehicleId: vehicle.id, kind: BudgetKind.FUEL,
      year: thisYear, month: thisMonth,
      baseAmount: baseNow, rolloverIn: remainderLast,
      spentAmount: spent, isCutOff: cutoff,
    };
    await prisma.vehicleBudget.upsert({
      where: { vehicleId_kind_year_month: { vehicleId: vehicle.id, kind: BudgetKind.FUEL, year: thisYear, month: thisMonth } },
      update: nowFuel,
      create: nowFuel,
    });

    // --- MANTENIMIENTO mes actual (independiente) ---
    const maintBase = 5000;
    const maintSpent = Math.round(maintBase * Math.random() * 0.6 * 100) / 100;
    const nowMaint = {
      vehicleId: vehicle.id, kind: BudgetKind.MAINTENANCE,
      year: thisYear, month: thisMonth,
      baseAmount: maintBase, rolloverIn: 0, spentAmount: maintSpent,
    };
    await prisma.vehicleBudget.upsert({
      where: { vehicleId_kind_year_month: { vehicleId: vehicle.id, kind: BudgetKind.MAINTENANCE, year: thisYear, month: thisMonth } },
      update: nowMaint,
      create: nowMaint,
    });
  }
  console.log(`   ✅ ${vehicles.length * 3} registros de presupuesto`);

  // ============================================
  // 8. CARGAS DE COMBUSTIBLE (200) con odometer nullable + NF
  // ============================================
  console.log('⛽ Cargas de combustible...');
  let loadsCreated = 0;

  // FuelLoad no tiene clave única natural -> guardia por conteo (no duplicar cargas).
  if ((await prisma.fuelLoad.count()) === 0) {
  for (let i = 0; i < 200; i++) {
    const vehicleIndex = i % 30;
    const vehicle = vehicles[vehicleIndex];
    const operator = operators[vehicleIndex];
    const vType = vehicleTypes.find((vt) => vt.id === vehicle.vehicleTypeId)!;

    const loadDate = new Date(now); loadDate.setDate(loadDate.getDate() - Math.floor(Math.random() * 90));

    let liters: number;
    if (vType.name === 'Tractocamión' || vType.name === 'Camión de carga') liters = 80 + Math.floor(Math.random() * 120);
    else if (vType.name === 'Camioneta 3.5 ton') liters = 40 + Math.floor(Math.random() * 60);
    else liters = 20 + Math.floor(Math.random() * 40);

    const pricePerLiter = 22 + Math.random() * 4;
    const amount = Math.round(liters * pricePerLiter * 100) / 100;

    const kmDriven = Math.round(liters * vType.expectedKmPerLiter * (0.8 + Math.random() * 0.4));

    // 8% de cargas con odómetro NF
    const nf = Math.random() < 0.08;
    const odometer = nf ? null : vehicle.currentOdometer + (Math.floor(i / 30) + 1) * kmDriven;
    const odometerStatus: OdometerStatus = nf ? 'NF' : 'OK';

    // 5% en gasolinera no aprobada
    const isUnapproved = Math.random() < 0.05;
    const station = isUnapproved ? unapprovedStation : stations[Math.floor(Math.random() * stations.length)];

    // 10% pendiente de revisión (simula portal público)
    const status: FuelLoadStatus = Math.random() < 0.1 ? 'PENDING_REVIEW' : 'APPROVED';

    await prisma.fuelLoad.create({
      data: {
        vehicleId: vehicle.id,
        operatorId: operator.id,
        operatorNameRaw: operator.fullName,
        operatorEmployeeRaw: operator.employeeNumber,
        stationId: station.id,
        liters,
        amount,
        odometer,
        odometerStatus,
        kmPerLiter: !nf && i >= 30 ? Math.round((kmDriven / liters) * 100) / 100 : null,
        isApproved: !isUnapproved,
        status,
        loadDate,
      },
    });
    loadsCreated++;
  }
  console.log(`   ✅ ${loadsCreated} cargas`);
  } else {
    console.log('   ⏭️  cargas ya existen — omitido (idempotente)');
  }

  // ============================================
  // 9. CATÁLOGO DE SERVICIOS
  // ============================================
  console.log('🔧 Catálogo de servicios...');
  const services = [
    { name: 'Cambio de aceite', intervalKm: 10000 },
    { name: 'Revisión de frenos', intervalKm: 40000 },
    { name: 'Cambio de llantas', intervalKm: 60000 },
    { name: 'Afinación mayor', intervalKm: 30000 },
    { name: 'Revisión de suspensión', intervalKm: 50000 },
  ];
  // ServiceCatalog no tiene clave única natural (vehicleTypeId+name) -> guardia por conteo.
  if ((await prisma.serviceCatalog.count()) === 0) {
    for (const vType of vehicleTypes) {
      for (const service of services) {
        await prisma.serviceCatalog.create({
          data: {
            vehicleTypeId: vType.id,
            name: service.name,
            intervalKm: service.intervalKm,
            description: `${service.name} programado cada ${service.intervalKm.toLocaleString()} km`,
          },
        });
      }
    }
    console.log('   ✅ 25 servicios');
  } else {
    console.log('   ⏭️  catálogo de servicios ya existe — omitido (idempotente)');
  }

  // ============================================
  // 10. USUARIOS — 4 roles nuevos
  // ============================================
  console.log('👤 Usuarios (upsert idempotente)...');
  // Coste bcrypt desde env (mismo mínimo que producción). Contraseñas demo desde
  // env (SEED_*_PASSWORD); si faltan, se generan aleatorias y se imprimen UNA vez
  // al final. Sin literales débiles hardcodeados.
  const saltRounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const adminCred = resolveSeedPassword('SEED_ADMIN_PASSWORD');
  const superCred = resolveSeedPassword('SEED_SUPER_PASSWORD');
  const executorCred = resolveSeedPassword('SEED_EXECUTOR_PASSWORD');
  const workshopCred = resolveSeedPassword('SEED_WORKSHOP_PASSWORD');
  const adminPass = await bcrypt.hash(adminCred.value, saltRounds);
  const superPass = await bcrypt.hash(superCred.value, saltRounds);
  const executorPass = await bcrypt.hash(executorCred.value, saltRounds);
  const workshopPass = await bcrypt.hash(workshopCred.value, saltRounds);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@flotillas.com' },
    update: { passwordHash: adminPass, role: UserRole.ADMIN, isActive: true },
    create: {
      email: 'admin@flotillas.com',
      passwordHash: adminPass,
      fullName: 'Administrador General',
      role: UserRole.ADMIN,
    },
  });
  const supVeh = await prisma.user.upsert({
    where: { email: 'vehiculos@flotillas.com' },
    update: { passwordHash: superPass, role: UserRole.SUPERVISOR_VEHICLES, isActive: true },
    create: {
      email: 'vehiculos@flotillas.com',
      passwordHash: superPass,
      fullName: 'Juan Pérez (Sup. Vehículos)',
      role: UserRole.SUPERVISOR_VEHICLES,
    },
  });
  await prisma.user.upsert({
    where: { email: 'gasolina@flotillas.com' },
    update: { passwordHash: superPass, role: UserRole.SUPERVISOR_FUEL, isActive: true },
    create: {
      email: 'gasolina@flotillas.com',
      passwordHash: superPass,
      fullName: 'María López (Sup. Gasolina)',
      role: UserRole.SUPERVISOR_FUEL,
    },
  });
  await prisma.user.upsert({
    where: { email: 'mantenimiento@flotillas.com' },
    update: { passwordHash: superPass, role: UserRole.SUPERVISOR_MAINTENANCE, isActive: true },
    create: {
      email: 'mantenimiento@flotillas.com',
      passwordHash: superPass,
      fullName: 'Pedro Ramírez (Sup. Mantenimiento)',
      role: UserRole.SUPERVISOR_MAINTENANCE,
    },
  });

  // ─── EJECUTORES (2 usuarios, cada uno responsable de 5 vehículos) ───
  const executor1 = await prisma.user.upsert({
    where: { email: 'ejecutor1@flotillas.com' },
    update: { passwordHash: executorPass, role: UserRole.EXECUTOR, isActive: true },
    create: {
      email: 'ejecutor1@flotillas.com',
      passwordHash: executorPass,
      fullName: 'Carlos Hernández (Ejecutor Centro)',
      role: UserRole.EXECUTOR,
    },
  });
  const executor2 = await prisma.user.upsert({
    where: { email: 'ejecutor2@flotillas.com' },
    update: { passwordHash: executorPass, role: UserRole.EXECUTOR, isActive: true },
    create: {
      email: 'ejecutor2@flotillas.com',
      passwordHash: executorPass,
      fullName: 'Mónica Ríos (Ejecutor Norte)',
      role: UserRole.EXECUTOR,
    },
  });

  // Asignar los primeros 10 vehículos: 5 a ejecutor1, 5 a ejecutor2
  for (let i = 0; i < Math.min(10, vehicles.length); i++) {
    await prisma.vehicle.update({
      where: { id: vehicles[i].id },
      data: { executorId: i < 5 ? executor1.id : executor2.id },
    });
  }

  // ─── TALLERES (3 cuentas vinculadas a los 3 primeros workshops) ───
  for (let i = 0; i < Math.min(3, workshops.length); i++) {
    const email = `taller${i + 1}@flotillas.com`;
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash: workshopPass, role: UserRole.WORKSHOP, workshopId: workshops[i].id, isActive: true },
      create: {
        email,
        passwordHash: workshopPass,
        fullName: `Operador de ${workshops[i].tradeName || workshops[i].legalName.split(' S.A.')[0]}`,
        role: UserRole.WORKSHOP,
        workshopId: workshops[i].id,
      },
    });
  }

  // ============================================
  // 11. NOTAS DE BITÁCORA (muestra en primeros 5 vehículos)
  // ============================================
  console.log('📝 Bitácora de notas...');
  const sampleNotes = [
    'Unidad presenta vibración leve en ralentí. Revisar en próximo servicio.',
    'Rayón menor en costado derecho — sin impacto operativo.',
    'Operador reporta aire acondicionado intermitente.',
    'Cambio de llanta delantera izquierda tras ponchadura.',
    'Revisión visual: todo en orden.',
  ];
  // VehicleNote no tiene clave única natural -> guardia por conteo.
  if ((await prisma.vehicleNote.count()) === 0) {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 2; j++) {
        const ago = new Date(now); ago.setDate(ago.getDate() - (i * 10 + j * 5));
        await prisma.vehicleNote.create({
          data: {
            vehicleId: vehicles[i].id,
            content: sampleNotes[(i + j) % sampleNotes.length],
            createdBy: j % 2 === 0 ? admin.id : supVeh.id,
            createdAt: ago,
            updatedAt: ago,
          },
        });
      }
    }
    console.log('   ✅ 10 notas de bitácora');
  } else {
    console.log('   ⏭️  notas ya existen — omitido (idempotente)');
  }

  console.log('');
  console.log('========================================');
  console.log('🎉 Seed v2 completado');
  console.log('========================================');
  console.log('');
  console.log('Usuarios (las contraseñas generadas se muestran UNA sola vez):');
  const accounts: { email: string; role: string; cred: { value: string; fromEnv: boolean } }[] = [
    { email: 'admin@flotillas.com', role: 'ADMIN', cred: adminCred },
    { email: 'vehiculos@flotillas.com', role: 'SUPERVISOR_VEHICLES', cred: superCred },
    { email: 'gasolina@flotillas.com', role: 'SUPERVISOR_FUEL', cred: superCred },
    { email: 'mantenimiento@flotillas.com', role: 'SUPERVISOR_MAINTENANCE', cred: superCred },
    { email: 'ejecutor1@flotillas.com', role: 'EXECUTOR (5 vehículos)', cred: executorCred },
    { email: 'ejecutor2@flotillas.com', role: 'EXECUTOR (5 vehículos)', cred: executorCred },
    { email: 'taller1@flotillas.com', role: 'WORKSHOP', cred: workshopCred },
    { email: 'taller2@flotillas.com', role: 'WORKSHOP', cred: workshopCred },
    { email: 'taller3@flotillas.com', role: 'WORKSHOP', cred: workshopCred },
  ];
  for (const a of accounts) {
    const shown = a.cred.fromEnv ? '«definida por SEED_*_PASSWORD»' : a.cred.value;
    console.log(`  ${a.email.padEnd(30)} ${shown.padEnd(32)} (${a.role})`);
  }
  if ([adminCred, superCred, executorCred, workshopCred].some((c) => !c.fromEnv)) {
    console.log('');
    console.log('  ⚠ Contraseñas generadas al azar (arriba). Guárdalas ahora: NO se vuelven a');
    console.log('    mostrar. Para fijarlas, define SEED_ADMIN_PASSWORD / SEED_SUPER_PASSWORD /');
    console.log('    SEED_EXECUTOR_PASSWORD / SEED_WORKSHOP_PASSWORD antes de sembrar.');
  }
  console.log('');
  console.log('Portal público (sin login):');
  console.log('  http://localhost:3000/cargas/registro-rapido');
  console.log('  Ejemplo: employeeNumber=EMP-00001, economicNumber=ECO-0001');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
