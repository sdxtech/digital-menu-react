import { useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'

const ChefStoreRequest = () => {
  const { menuProductions, markStoreRequested } = useChefData()
  const [infoMessage, setInfoMessage] = useState('')

  const approvedMenus = useMemo(
    () => menuProductions.filter((item) => item.approvalStatus === 'approved'),
    [menuProductions],
  )

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Store Request
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Menu produksi approved Unit Manager
        </h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Sumber data
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Daftar menu siap diajukan ke store
            </h3>
            <p className="mt-2 text-sm text-muted">
              Menu di halaman ini berasal dari Menu Production yang sudah
              di-approve Unit Manager.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setInfoMessage('Data approve sudah ter-refresh dari Menu Production.')
            }
            className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
          >
            Refresh data approve
          </button>
        </div>
        {infoMessage ? (
          <p className="mt-3 text-xs font-medium text-primary">{infoMessage}</p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-background">
            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
              <th className="px-5 py-4 font-semibold">Nama menu</th>
              <th className="px-5 py-4 font-semibold">Kategori</th>
              <th className="px-5 py-4 font-semibold">Tanggal produksi</th>
              <th className="px-5 py-4 font-semibold">Portion</th>
              <th className="px-5 py-4 font-semibold">Status approval</th>
              <th className="px-5 py-4 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {approvedMenus.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={6} className="px-5 py-10 text-center text-muted">
                  Belum ada menu produksi yang di-approve Unit Manager.
                </td>
              </tr>
            ) : (
              approvedMenus.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-5 py-4">{item.menuName}</td>
                  <td className="px-5 py-4">{item.category}</td>
                  <td className="px-5 py-4">{item.productionDate}</td>
                  <td className="px-5 py-4">{item.portion}</td>
                  <td className="px-5 py-4">Approved</td>
                  <td className="px-5 py-4">
                    {item.storeRequestStatus === 'requested' ? (
                      <span className="text-xs font-semibold text-primary">
                        Sudah diajukan
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markStoreRequested(item.id)}
                        className="text-xs font-semibold text-primary"
                      >
                        Ajukan ke store
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ChefStoreRequest
