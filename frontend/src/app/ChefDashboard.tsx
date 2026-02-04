const ChefDashboard = () => {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Dashboard
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Today's Kitchen Summary</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Incoming orders
          </p>
          <p className="mt-3 text-3xl font-semibold">72</p>
          <p className="mt-2 text-xs text-muted">+12% from yesterday</p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Menus completed
          </p>
          <p className="mt-3 text-3xl font-semibold">58</p>
          <p className="mt-2 text-xs text-muted">Target 80 menus</p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Average time
          </p>
          <p className="mt-3 text-3xl font-semibold text-primary">8m</p>
          <p className="mt-2 text-xs text-muted">Down 1m from last shift</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Priority
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                Menus that must be ready
              </h3>
            </div>
            <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              4 items
            </span>
          </div>
          <div className="mt-6 space-y-4">
            {[
              { name: 'Iced Matcha', status: 'In progress', time: '08:10' },
              { name: 'Teriyaki Chicken Rice', status: 'Queue 2', time: '08:22' },
              { name: 'Tuna Sandwich', status: 'Queue 3', time: '08:30' },
              {
                name: 'Palm Sugar Milk Coffee',
                status: 'Queue 4',
                time: '08:40',
              },
            ].map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted">{item.status}</p>
                </div>
                <span className="text-xs font-semibold text-primary">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Shift timeline
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Key ingredient prep
          </h3>
          <div className="mt-6 space-y-4">
            {[
              { label: 'Prep vegetables & sauce', progress: 'Done' },
              { label: 'Batch coffee & tea', progress: 'In progress' },
              { label: 'Breakfast plating', progress: 'Waiting' },
            ].map((task) => (
              <div
                key={task.label}
                className="rounded-2xl border border-border bg-background px-4 py-3 text-sm"
              >
                <p className="font-medium text-foreground">{task.label}</p>
                <p className="mt-1 text-xs text-muted">{task.progress}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefDashboard
