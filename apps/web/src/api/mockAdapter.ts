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
  amountPaise: bigint; // positive = credit/increase, negative = deduction
  reference?: string;
  reason?: string; // For adjustments/reversals
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
  enquiryId?: string;
  residentName: string;
  phone: string;
  floorId: string;
  roomId: string;
  bedId: string;
  expectedMoveInDate: string;
}

// In-memory mock storage for demo testing
const paymentsByReference = new Map<string, PaymentReceipt>();
const paymentsByIdempotency = new Map<string, PaymentReceipt>();

// Simulated occupied beds dynamically tracking allocations
const allocatedBedKeys = new Set<string>(['ground-001-A', 'ground-001-B', 'first-101-A']);

export class MockDataService {
  private simulateLatencyMs: number;
  public simulateConflictOnBed: string | null = null;
  public simulateUnconfiguredRule: string | null = null;

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

  async getResidentStatement(residentId: string): Promise<ResidentStatement> {
    await this.delay();
    if (this.simulateUnconfiguredRule) {
      throw new RuleNotConfiguredError(this.simulateUnconfiguredRule);
    }

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
        id: residentId || 'res_demo_01',
        name: 'Devashish Sen',
        phone: '+91 98450 12345',
        roomNumber: '103',
        bedLetter: 'B',
        checkInDate: '2026-10-01',
        balancePaise: running,
        status: 'active',
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

    const receiptNumber = `REC-2026-${String(paymentsByReference.size + 1042).padStart(6, '0')}`;
    const receipt: PaymentReceipt = {
      receiptNumber,
      residentId: input.residentId,
      residentName: 'Devashish Sen',
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
    return {
      success: true,
      allocationId: `alloc_${Date.now()}_${idempotencyKey.slice(0, 8)}`,
    };
  }
}

export const mockDataService = new MockDataService();
