import {
  ConflictError,
  RuleNotConfiguredError,
} from './errors';
import { demoFloors, demoProperty, type Floor } from '../propertyDemo';

export interface ResidentRecord {
  id: string;
  name: string;
  phone: string;
  roomNumber: string;
  bedLetter: string;
  checkInDate: string;
  balancePaise: bigint;
  status: 'active' | 'notice' | 'checked_out';
}

export interface StatementLineItem {
  id: string;
  date: string;
  type: 'charge' | 'payment' | 'allocation' | 'adjustment';
  description: string;
  amountPaise: bigint; // positive = charge/receivable, negative = payment/reversal
  reference?: string | undefined;
  reason?: string | undefined; // For adjustments/reversals
  runningBalancePaise: bigint;
}

export interface ResidentStatement {
  resident: ResidentRecord;
  lineItems: StatementLineItem[];
  currentBalancePaise: bigint;
}

export interface PaymentReceipt {
  receiptNumber: string;
  residentId: string;
  residentName: string;
  amountPaise: bigint;
  date: string;
  method: 'upi' | 'bank_transfer' | 'cash' | 'cheque';
  reference: string;
  settledChargeId: string;
  settledChargeDescription: string;
  recordedBy: string;
  timestamp: string;
  idempotencyKey: string;
}

export interface RecordPaymentInput {
  residentId: string;
  amountPaise: bigint;
  date: string;
  method: 'upi' | 'bank_transfer' | 'cash' | 'cheque';
  reference: string;
  settledChargeId: string;
}

export interface AllocationInput {
  enquiryId?: string | undefined;
  residentName: string;
  phone: string;
  floorId: string;
  roomId: string;
  bedId: string;
  expectedMoveInDate: string;
}

export interface EnquiryItem {
  id: string;
  applicantName: string;
  phone: string;
  preferredRoomType: string;
  moveInDate: string;
  notes?: string | undefined;
  status: 'pending' | 'allocated' | 'cancelled';
  createdAt: string;
}

export interface ResidentListItem extends ResidentRecord {
  ageingDays: number;
  ageingBucket: 'current' | '1-30' | '31-60' | '60+';
}

export interface TodayCollectionItem {
  receiptNumber: string;
  residentName: string;
  roomBed: string;
  amountPaise: bigint;
  method: 'upi' | 'bank_transfer' | 'cash' | 'cheque';
  time: string;
  reference: string;
}

export interface MaintenanceItem {
  id: string;
  floorName: string;
  roomNumber: string;
  bedLetter?: string | undefined;
  issue: string;
  status: 'reported' | 'in_progress' | 'resolved';
  reportedDate: string;
}

export interface OwnerDashboardSummary {
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  unavailableBeds: number;
  occupancyRate: number;
  totalOutstandingPaise: bigint;
  todayCollectionsPaise: bigint;
  collectionsByMethod: {
    upi: bigint;
    bank_transfer: bigint;
    cash: bigint;
    cheque: bigint;
  };
  ageingSummary: {
    currentPaise: bigint;
    bucket1To30Paise: bigint;
    bucket31To60Paise: bigint;
    bucketOver60Paise: bigint;
  };
  residents: ResidentListItem[];
  todayCollections: TodayCollectionItem[];
}

export interface SettlableCharge {
  id: string;
  description: string;
  date: string;
  originalAmountPaise: bigint;
  outstandingPaise: bigint;
}

// In-memory mock storage for demo operations
const paymentsByReference = new Map<string, PaymentReceipt>();
const paymentsByIdempotency = new Map<string, PaymentReceipt>();

// Simulated occupied beds dynamically tracking allocations
const allocatedBedKeys = new Set<string>([
  'ground-001-A',
  'ground-001-B',
  'ground-002-A',
  'ground-002-B',
  'ground-002-C',
  'ground-003-B',
  'ground-003-C',
  'first-101-A',
  'first-101-B',
  'first-102-A',
  'first-102-B',
  'first-102-C',
  'first-102-D',
  'first-103-A',
  'first-103-C',
  'second-201-A',
  'second-201-C',
  'second-201-D',
  'second-202-B',
  'second-202-D',
  'second-203-A',
  'second-203-B',
  'second-203-D',
]);

const initialEnquiries: EnquiryItem[] = [
  {
    id: 'enq_01',
    applicantName: 'Sneha Kulkarni',
    phone: '+91 98234 56789',
    preferredRoomType: 'Double Sharing (Room 101 or 103)',
    moveInDate: '2026-11-05',
    notes: 'Looking for a peaceful room with good ventilation.',
    status: 'pending',
    createdAt: '2026-10-30',
  },
  {
    id: 'enq_02',
    applicantName: 'Rohan Mehra',
    phone: '+91 97112 34567',
    preferredRoomType: 'Triple Sharing',
    moveInDate: '2026-11-10',
    notes: 'Working in tech park nearby; prefers Ground floor.',
    status: 'pending',
    createdAt: '2026-10-31',
  },
  {
    id: 'enq_03',
    applicantName: 'Priya Sundaram',
    phone: '+91 94451 98765',
    preferredRoomType: 'Double Sharing',
    moveInDate: '2026-11-01',
    notes: 'Immediate joining if ground floor is free.',
    status: 'pending',
    createdAt: '2026-10-31',
  },
];

const mockResidents: ResidentListItem[] = [
  {
    id: 'res_demo_01',
    name: 'Devashish Sen',
    phone: '+91 98450 12345',
    roomNumber: '103',
    bedLetter: 'B',
    checkInDate: '2026-10-01',
    balancePaise: 100000n, // ₹1,000.00
    status: 'active',
    ageingDays: 16,
    ageingBucket: '1-30',
  },
  {
    id: 'res_demo_02',
    name: 'Manish Tiwari',
    phone: '+91 98801 22334',
    roomNumber: '101',
    bedLetter: 'A',
    checkInDate: '2026-08-15',
    balancePaise: 1500000n, // ₹15,000.00
    status: 'active',
    ageingDays: 45,
    ageingBucket: '31-60',
  },
  {
    id: 'res_demo_03',
    name: 'Tanvi Deshmukh',
    phone: '+91 99160 88776',
    roomNumber: '201',
    bedLetter: 'A',
    checkInDate: '2026-06-01',
    balancePaise: 0n, // ₹0.00
    status: 'active',
    ageingDays: 0,
    ageingBucket: 'current',
  },
  {
    id: 'res_demo_04',
    name: 'Gaurav Bhattacharya',
    phone: '+91 97400 55443',
    roomNumber: '202',
    bedLetter: 'B',
    checkInDate: '2026-05-10',
    balancePaise: 3200000n, // ₹32,000.00 (rent + mess backlog)
    status: 'notice',
    ageingDays: 72,
    ageingBucket: '60+',
  },
];

const mockMaintenance: MaintenanceItem[] = [
  {
    id: 'mnt_01',
    floorName: 'Ground floor',
    roomNumber: '002',
    bedLetter: 'D',
    issue: 'Window latch replacement & mesh repair',
    status: 'in_progress',
    reportedDate: '2026-10-28',
  },
  {
    id: 'mnt_02',
    floorName: 'First floor',
    roomNumber: '103',
    bedLetter: 'D',
    issue: 'Bathroom mixer fixture replacement',
    status: 'in_progress',
    reportedDate: '2026-10-29',
  },
  {
    id: 'mnt_03',
    floorName: 'Second floor',
    roomNumber: '202',
    bedLetter: 'C',
    issue: 'Wall plaster peeling near electrical switch',
    status: 'reported',
    reportedDate: '2026-10-31',
  },
];

const mockTodayCollections: TodayCollectionItem[] = [
  {
    receiptNumber: 'REC-2026-001040',
    residentName: 'Tanvi Deshmukh',
    roomBed: '201-A',
    amountPaise: 1500000n, // ₹15,000.00
    method: 'upi',
    time: '10:14 AM',
    reference: 'UPI/261031/11902',
  },
  {
    receiptNumber: 'REC-2026-001041',
    residentName: 'Abhishek Iyer',
    roomBed: '001-A',
    amountPaise: 1500000n, // ₹15,000.00
    method: 'bank_transfer',
    time: '11:45 AM',
    reference: 'NEFT/261031/77019',
  },
  {
    receiptNumber: 'REC-2026-001042',
    residentName: 'Kunal Joshi',
    roomBed: '102-B',
    amountPaise: 500000n, // ₹5,000.00
    method: 'cash',
    time: '02:30 PM',
    reference: 'CSH/261031/00881',
  },
];

export class MockDataService {
  private simulateLatencyMs: number;
  public simulateConflictOnBed: string | null = null;
  public simulateUnconfiguredRule: string | null = null;
  private enquiries = [...initialEnquiries];

  constructor(latencyMs = 80) {
    this.simulateLatencyMs = latencyMs;
  }

  private async delay(): Promise<void> {
    if (this.simulateLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulateLatencyMs));
    }
  }

  async getProperty() {
    await this.delay();
    return demoProperty;
  }

  async getFloors(): Promise<Floor[]> {
    await this.delay();
    return demoFloors;
  }

  async getEnquiries(): Promise<EnquiryItem[]> {
    await this.delay();
    return this.enquiries;
  }

  async submitPublicEnquiry(input: Omit<EnquiryItem, 'id' | 'status' | 'createdAt'>): Promise<EnquiryItem> {
    await this.delay();
    const newEnquiry: EnquiryItem = {
      id: `enq_${Date.now()}`,
      applicantName: input.applicantName,
      phone: input.phone,
      preferredRoomType: input.preferredRoomType,
      moveInDate: input.moveInDate,
      notes: input.notes,
      status: 'pending',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    this.enquiries.unshift(newEnquiry);
    return newEnquiry;
  }

  async getResidents(): Promise<ResidentListItem[]> {
    await this.delay();
    return mockResidents;
  }

  async getMaintenanceRequests(): Promise<MaintenanceItem[]> {
    await this.delay();
    return mockMaintenance;
  }

  async getSettlableCharges(residentId: string): Promise<SettlableCharge[]> {
    await this.delay();
    if (residentId === 'res_demo_01') {
      return [
        {
          id: 'txn_05',
          description: 'Utility Charge — AC Electricity Sub-meter',
          date: '2026-10-15',
          originalAmountPaise: 125000n,
          outstandingPaise: 100000n, // ₹1,000.00 outstanding after 250 adjustment
        },
      ];
    }
    return [
      {
        id: 'txn_rent_due',
        description: 'Monthly Bed Rent — Current Month',
        date: '2026-10-01',
        originalAmountPaise: 1500000n,
        outstandingPaise: 1500000n,
      },
    ];
  }

  async getOwnerDashboard(): Promise<OwnerDashboardSummary> {
    await this.delay();
    if (this.simulateUnconfiguredRule) {
      throw new RuleNotConfiguredError(this.simulateUnconfiguredRule);
    }

    const allBeds = demoFloors.flatMap((f) => f.rooms.flatMap((r) => r.beds));
    const totalBeds = allBeds.length;
    const occupiedBeds = allBeds.filter((b) => b.status === 'occupied').length;
    const availableBeds = allBeds.filter((b) => b.status === 'available').length;
    const unavailableBeds = allBeds.filter((b) => b.status === 'unavailable').length;
    const occupancyRate = Math.round((occupiedBeds / (totalBeds || 1)) * 100);

    const totalOutstandingPaise = mockResidents.reduce((acc, r) => acc + r.balancePaise, 0n);

    const collectionsByMethod = {
      upi: 1500000n,
      bank_transfer: 1500000n,
      cash: 500000n,
      cheque: 0n,
    };
    const todayCollectionsPaise =
      collectionsByMethod.upi +
      collectionsByMethod.bank_transfer +
      collectionsByMethod.cash +
      collectionsByMethod.cheque;

    const ageingSummary = {
      currentPaise: 0n,
      bucket1To30Paise: 100000n, // Devashish
      bucket31To60Paise: 1500000n, // Manish
      bucketOver60Paise: 3200000n, // Gaurav
    };

    return {
      totalBeds,
      occupiedBeds,
      availableBeds,
      unavailableBeds,
      occupancyRate,
      totalOutstandingPaise,
      todayCollectionsPaise,
      collectionsByMethod,
      ageingSummary,
      residents: mockResidents,
      todayCollections: mockTodayCollections,
    };
  }

  async getResidentStatement(residentId: string): Promise<ResidentStatement> {
    await this.delay();
    if (this.simulateUnconfiguredRule) {
      throw new RuleNotConfiguredError(this.simulateUnconfiguredRule);
    }

    const resident = mockResidents.find((r) => r.id === residentId) ?? mockResidents[0]!;

    // Honest synthetic resident statement: balance is derived, line by line
    const lines: Omit<StatementLineItem, 'runningBalancePaise'>[] = [
      {
        id: 'txn_01',
        date: '2026-10-01',
        type: 'charge',
        description: 'Security Deposit (Standard 2 Months)',
        amountPaise: 3000000n, // ₹30,000.00
      },
      {
        id: 'txn_02',
        date: '2026-10-01',
        type: 'payment',
        description: 'Deposit payment via UPI',
        amountPaise: -3000000n,
        reference: 'UPI/261001/98124',
      },
      {
        id: 'txn_03',
        date: '2026-10-01',
        type: 'charge',
        description: 'Monthly Bed Rent — October 2026',
        amountPaise: 1500000n, // ₹15,000.00
      },
      {
        id: 'txn_04',
        date: '2026-10-04',
        type: 'payment',
        description: 'Rent payment via IMPS Bank Transfer',
        amountPaise: -1500000n,
        reference: 'IMPS/261004/77411',
      },
      {
        id: 'txn_05',
        date: '2026-10-15',
        type: 'charge',
        description: 'Utility Charge — AC Electricity Sub-meter',
        amountPaise: 125000n, // ₹1,250.00
      },
      {
        id: 'txn_06',
        date: '2026-10-20',
        type: 'adjustment',
        description: 'Sub-meter correction adjustment',
        amountPaise: -25000n, // -₹250.00 reversal
        reason: 'Recalibrated sub-meter reading after tenant check',
      },
    ];

    // Compute derived running balances in date order
    let running = 0n;
    const lineItems: StatementLineItem[] = lines.map((item) => {
      running += item.amountPaise;
      return {
        ...item,
        runningBalancePaise: running,
      };
    });

    return {
      resident: {
        id: resident.id,
        name: resident.name,
        phone: resident.phone,
        roomNumber: resident.roomNumber,
        bedLetter: resident.bedLetter,
        checkInDate: resident.checkInDate,
        balancePaise: running,
        status: resident.status,
      },
      lineItems,
      currentBalancePaise: running, // ₹1,000.00 outstanding
    };
  }

  async recordPayment(input: RecordPaymentInput, idempotencyKey: string): Promise<PaymentReceipt> {
    await this.delay();

    if (this.simulateUnconfiguredRule) {
      throw new RuleNotConfiguredError(this.simulateUnconfiguredRule);
    }

    // Check idempotency key: re-return existing receipt if previously processed
    if (paymentsByIdempotency.has(idempotencyKey)) {
      return paymentsByIdempotency.get(idempotencyKey)!;
    }

    // Refuse duplicate reference numbers with honest link/detail
    const existingRef = paymentsByReference.get(input.reference);
    if (existingRef) {
      throw new ConflictError(
        `Duplicate payment reference "${input.reference}". It was already recorded on receipt ${existingRef.receiptNumber} dated ${existingRef.date}.`
      );
    }

    const resident = mockResidents.find((r) => r.id === input.residentId) ?? mockResidents[0]!;
    const receiptNumber = `REC-2026-${String(paymentsByReference.size + 1043).padStart(6, '0')}`;
    const receipt: PaymentReceipt = {
      receiptNumber,
      residentId: resident.id,
      residentName: resident.name,
      amountPaise: input.amountPaise,
      date: input.date,
      method: input.method,
      reference: input.reference,
      settledChargeId: input.settledChargeId,
      settledChargeDescription: 'Utility Charge — AC Electricity Sub-meter',
      recordedBy: 'Current User (Session Authority)',
      timestamp: new Date().toISOString(),
      idempotencyKey,
    };

    paymentsByReference.set(input.reference, receipt);
    paymentsByIdempotency.set(idempotencyKey, receipt);

    return receipt;
  }

  async allocateBed(input: AllocationInput, idempotencyKey: string): Promise<{ success: boolean; allocationId: string }> {
    await this.delay();

    if (this.simulateUnconfiguredRule) {
      throw new RuleNotConfiguredError(this.simulateUnconfiguredRule);
    }

    const bedKey = `${input.floorId}-${input.roomId}-${input.bedId}`;

    // Non-negotiable rule 2: Selecting a bed does not hold it.
    // If taken between selection and submit, return 409 Conflict.
    if (allocatedBedKeys.has(bedKey) || this.simulateConflictOnBed === bedKey) {
      throw new ConflictError(
        `Bed ${input.bedId} in Room ${input.roomId} was allocated to another applicant moments ago. Selecting a bed does not hold it. Please choose another free bed.`
      );
    }

    allocatedBedKeys.add(bedKey);

    // If an enquiry was associated, mark it allocated
    if (input.enquiryId) {
      const enq = this.enquiries.find((e) => e.id === input.enquiryId);
      if (enq) {
        enq.status = 'allocated';
      }
    }

    return {
      success: true,
      allocationId: `alloc_${Date.now()}_${idempotencyKey.slice(0, 8)}`,
    };
  }
}

export const mockDataService = new MockDataService();
