import { Router } from 'express';

interface HRRequestDetails {
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  attendanceChangeReason?: string;
  leaveType?: string;
  leaveDays?: number;
  extraBreakMinutes?: number;
}

interface HRRequest {
  id: string;
  userId: string;
  userName?: string;
  type: 'Correction' | 'Leave' | 'Break_Exception';
  date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  details: HRRequestDetails;
  submittedAt: string;
  decidedBy?: string;
  decisionReason?: string;
}

const router = Router();

/*
 * Temporary server-side storage.
 * Requests remain available while the backend server is running.
 */
let hrRequests: HRRequest[] = [];

/**
 * GET /api/hr-requests
 * Return all HR requests.
 */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    requests: hrRequests
  });
});

/**
 * POST /api/hr-requests
 * Create a new HR request.
 */
router.post('/', (req, res) => {
  const {
    userId,
    userName,
    type,
    date,
    reason,
    details
  } = req.body;

  if (!userId || !type || !reason?.trim()) {
    res.status(400).json({
      success: false,
      message: 'User, request type and reason are required.'
    });
    return;
  }

  const allowedTypes = [
    'Correction',
    'Leave',
    'Break_Exception'
  ];

  if (!allowedTypes.includes(type)) {
    res.status(400).json({
      success: false,
      message: 'Invalid HR request type.'
    });
    return;
  }

  const newRequest: HRRequest = {
    id: `hrq-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    userId,
    userName,
    type,
    date: date || new Date().toISOString().split('T')[0],
    reason: reason.trim(),
    status: 'Pending',
    details: details || {},
    submittedAt: new Date()
      .toISOString()
      .replace('T', ' ')
      .substring(0, 16)
  };

  hrRequests = [newRequest, ...hrRequests];

  res.status(201).json({
    success: true,
    message: 'HR request submitted successfully.',
    request: newRequest
  });
});

/**
 * PATCH /api/hr-requests/:id/approve
 * Approve an HR request.
 */
router.patch('/:id/approve', (req, res) => {
  const request = hrRequests.find(
    (item) => item.id === req.params.id
  );

  if (!request) {
    res.status(404).json({
      success: false,
      message: 'HR request not found.'
    });
    return;
  }

  request.status = 'Approved';
  request.decidedBy = req.body.decidedBy;
  request.decisionReason = req.body.decisionReason;

  res.json({
    success: true,
    message: 'HR request approved successfully.',
    request
  });
});

/**
 * PATCH /api/hr-requests/:id/reject
 * Reject an HR request.
 */
router.patch('/:id/reject', (req, res) => {
  const request = hrRequests.find(
    (item) => item.id === req.params.id
  );

  if (!request) {
    res.status(404).json({
      success: false,
      message: 'HR request not found.'
    });
    return;
  }

  const decisionReason =
    req.body.decisionReason?.trim();

  if (!decisionReason) {
    res.status(400).json({
      success: false,
      message: 'A rejection reason is required.'
    });
    return;
  }

  request.status = 'Rejected';
  request.decidedBy = req.body.decidedBy;
  request.decisionReason = decisionReason;

  res.json({
    success: true,
    message: 'HR request rejected successfully.',
    request
  });
});

export default router;