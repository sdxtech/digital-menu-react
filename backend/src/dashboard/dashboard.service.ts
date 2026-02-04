import { Injectable } from '@nestjs/common';

@Injectable()
export class DashboardService {
  // BACKEND LOGIC: chef dashboard summary values (placeholder dataset).
  getChefSummary() {
    return {
      summary: {
        incomingOrders: 72,
        incomingOrdersDelta: 12,
        menusCompleted: 58,
        targetMenus: 80,
        avgTimeMinutes: 8,
        avgTimeDeltaMinutes: -1,
      },
      priority: [
        { name: 'Iced Matcha', status: 'In progress', time: '08:10' },
        { name: 'Teriyaki Chicken Rice', status: 'Queue 2', time: '08:22' },
        { name: 'Tuna Sandwich', status: 'Queue 3', time: '08:30' },
        { name: 'Palm Sugar Milk Coffee', status: 'Queue 4', time: '08:40' },
      ],
      shiftTimeline: [
        { label: 'Prep vegetables & sauce', progress: 'Done' },
        { label: 'Batch coffee & tea', progress: 'In progress' },
        { label: 'Breakfast plating', progress: 'Waiting' },
      ],
    };
  }
}
