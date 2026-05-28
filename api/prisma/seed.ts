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

const prisma = new PrismaClient(); // DATABASE_URL del .env

async function main() {
  console.log('🌱 Seed v2 iniciando...');

  // ============================================
  // 0. TIPOS DE VEHÍCULO + SECTORES
  // ============================================
  console.log('📦 Tipos de vehículo...');
  const vehicleTypes = await Promise.all([
    prisma.vehicleType.create({ data: { name: 'Camión de carga', expectedKmPerLiter: 4.5 } }),
    prisma.vehicleType.create({ data: { name: 'Camioneta 3.5 ton', expectedKmPerLiter: 8.0 } }),
    prisma.vehicleType.create({ data: { name: 'Sedán ejecutivo', expectedKmPerLiter: 14.0 } }),
    prisma.vehicleType.create({ data: { name: 'Van de reparto', expectedKmPerLiter: 10.0 } }),
    prisma.vehicleType.create({ data: { name: 'Tractocamión', expectedKmPerLiter: 3.0 } }),
  ]);
  console.log(`   ✅ ${vehicleTypes.length} tipos`);

  console.log('🏢 Sectores (catálogo inicial placeholder)...');
  const sectors = await Promise.all([
    prisma.sector.create({ data: { code: 'CENTRO', name: 'Zona Centro' } }),
    prisma.sector.create({ data: { code: 'NORTE', name: 'Zona Norte' } }),
    prisma.sector.create({ data: { code: 'SUR', name: 'Zona Sur' } }),
    prisma.sector.create({ data: { code: 'ORIENTE', name: 'Zona Oriente' } }),
    prisma.sector.create({ data: { code: 'PONIENTE', name: 'Zona Poniente' } }),
  ]);
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

      const vehicle = await prisma.vehicle.create({
        data: {
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
          status: 'OPERATIVE',
          isActive: true,
        },
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

    const operator = await prisma.operator.create({
      data: {
        employeeNumber: `EMP-${String(i + 1).padStart(5, '0')}`,  // EMP-00001, EMP-00002, ...
        fullName: `${firstNames[i]} ${lastNames[i]}`,
        licenseNumber: `LIC-${String(i + 1).padStart(6, '0')}`,
        licenseType: ['A', 'B', 'C', 'D', 'E'][i % 5],
        licenseExpiresAt: licExpiry,
        phone: `55${String(1000 + i).padStart(4, '0')}${String(Math.floor(Math.random() * 9000) + 1000)}`,
        email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@flotillas.com`,
      },
    });
    operators.push(operator);
  }
  console.log(`   ✅ ${operators.length} operadores`);

  // ============================================
  // 4. ASIGNACIONES (primeros 30 vehículos ↔ operadores)
  // ============================================
  console.log('🔗 Asignaciones...');
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
    const station = await prisma.approvedStation.create({ data: { ...s, isActive: true } });
    stations.push(station);
  }

  const unapprovedStation = await prisma.approvedStation.create({
    data: {
      rfc: 'XAXX010101000',
      legalName: 'Gasolinera Independiente No Autorizada',
      email: 'sinregistro@desconocido.mx',
      phone: '0000000000',
      address: 'Desconocida',
      isActive: false,
    },
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
    workshops.push(await prisma.workshop.create({ data: { ...w, isActive: true } }));
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
    // --- MES ANTERIOR (cerrado, con remanente simulado) ---
    const baseLast = 10000;
    const spentLast = Math.round(baseLast * (0.4 + Math.random() * 0.5) * 100) / 100; // 40-90% gastado
    const remainderLast = Math.max(0, baseLast - spentLast);

    await prisma.vehicleBudget.create({
      data: {
        vehicleId: vehicle.id, kind: BudgetKind.FUEL,
        year: lastYear, month: lastMonth,
        baseAmount: baseLast, rolloverIn: 0, spentAmount: spentLast,
        isClosed: true, closedAt: new Date(thisYear, thisMonth - 1, 1, 0, 5),
      },
    });

    // --- MES ACTUAL — rollover del anterior ya aplicado ---
    const spentPct = Math.random();
    let spent = 0;
    let cutoff = false;
    const baseNow = 10000;
    if (spentPct < 0.7) spent = Math.round(baseNow * Math.random() * 0.5 * 100) / 100;
    else if (spentPct < 0.9) spent = Math.round(baseNow * (0.75 + Math.random() * 0.15) * 100) / 100;
    else { spent = Math.round(baseNow * (1 + Math.random() * 0.1) * 100) / 100; cutoff = true; }

    await prisma.vehicleBudget.create({
      data: {
        vehicleId: vehicle.id, kind: BudgetKind.FUEL,
        year: thisYear, month: thisMonth,
        baseAmount: baseNow, rolloverIn: remainderLast,
        spentAmount: spent, isCutOff: cutoff,
      },
    });

    // --- MANTENIMIENTO mes actual (independiente) ---
    const maintBase = 5000;
    const maintSpent = Math.round(maintBase * Math.random() * 0.6 * 100) / 100;
    await prisma.vehicleBudget.create({
      data: {
        vehicleId: vehicle.id, kind: BudgetKind.MAINTENANCE,
        year: thisYear, month: thisMonth,
        baseAmount: maintBase, rolloverIn: 0, spentAmount: maintSpent,
      },
    });
  }
  console.log(`   ✅ ${vehicles.length * 3} registros de presupuesto`);

  // ============================================
  // 8. CARGAS DE COMBUSTIBLE (200) con odometer nullable + NF
  // ============================================
  console.log('⛽ Cargas de combustible...');
  let loadsCreated = 0;

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

  // ============================================
  // 10. USUARIOS — 4 roles nuevos
  // ============================================
  console.log('👤 Usuarios (upsert idempotente)...');
  const saltRounds = 10;
  const adminPass = await bcrypt.hash('admin123', saltRounds);
  const superPass = await bcrypt.hash('super123', saltRounds);
  const executorPass = await bcrypt.hash('ejecutor123', saltRounds);
  const workshopPass = await bcrypt.hash('taller123', saltRounds);

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

  console.log('');
  console.log('========================================');
  console.log('🎉 Seed v2 completado');
  console.log('========================================');
  console.log('');
  console.log('Usuarios:');
  console.log('  admin@flotillas.com           / admin123     (ADMIN)');
  console.log('  vehiculos@flotillas.com       / super123     (SUPERVISOR_VEHICLES)');
  console.log('  gasolina@flotillas.com        / super123     (SUPERVISOR_FUEL)');
  console.log('  mantenimiento@flotillas.com   / super123     (SUPERVISOR_MAINTENANCE)');
  console.log('  ejecutor1@flotillas.com       / ejecutor123  (EXECUTOR — 5 vehículos)');
  console.log('  ejecutor2@flotillas.com       / ejecutor123  (EXECUTOR — 5 vehículos)');
  console.log('  taller1@flotillas.com         / taller123    (WORKSHOP)');
  console.log('  taller2@flotillas.com         / taller123    (WORKSHOP)');
  console.log('  taller3@flotillas.com         / taller123    (WORKSHOP)');
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
