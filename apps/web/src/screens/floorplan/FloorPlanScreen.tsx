import { useState, useEffect } from 'react';
import { FloorPlan } from '../../components/FloorPlan';
import { FloorPlanList } from '../../components/FloorPlanList';
import { ErrorState } from '../../components/ErrorState';
import { mockDataService } from '../../api/mockAdapter';
import type { Floor } from '../../propertyDemo';
import type { FloorPlanState, FloorPlanAction } from '../../floorPlanState';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../auth/permissions';

interface FloorPlanScreenProps {
  state: FloorPlanState;
  dispatch: React.Dispatch<FloorPlanAction>;
}

export function FloorPlanScreen({ state, dispatch }: FloorPlanScreenProps) {
  const { can } = useAuth();
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    mockDataService
      .getFloors()
      .then((data) => {
        if (!cancelled) {
          setFloors(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to load floor inventory'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!can(PERMISSIONS.OCCUPANCY_READ)) {
    return (
      <ErrorState
        type="forbidden"
        message="Your active role lacks the occupancy.read permission required to view the interactive floor plan."
      />
    );
  }

  if (loading) {
    return (
      <div className="state-card" aria-busy="true" aria-live="polite">
        <div className="state-content">
          <h2>Loading floor schematic...</h2>
          <p>Validating spatial boundaries and resolving bed statuses.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        type="generic"
        title="Could not load floor plan"
        message={error.message}
        onRetry={() => {
          setLoading(true);
          setError(null);
          mockDataService.getFloors().then(setFloors).catch(setError).finally(() => setLoading(false));
        }}
      />
    );
  }

  const currentFloor = floors.find((f) => f.id === state.floorId) ?? floors[0];
  if (!currentFloor) {
    return (
      <ErrorState
        type="not-found"
        title="Floor not found"
        message="The requested floor layout does not exist in this property."
      />
    );
  }

  return (
    <div className="floorplan-screen">
      <div className="screen-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <button
          type="button"
          className="outline-button"
          onClick={() => setViewMode(viewMode === 'visual' ? 'list' : 'visual')}
          aria-label={viewMode === 'visual' ? 'Switch to accessible list view' : 'Switch to 2D visual layout'}
        >
          {viewMode === 'visual' ? '📋 View as Accessible Bed List' : '🗺️ View as 2D Schematic Plan'}
        </button>
      </div>

      {viewMode === 'visual' ? (
        <FloorPlan state={state} dispatch={dispatch} />
      ) : (
        <FloorPlanList
          floor={currentFloor}
          state={state}
          dispatch={dispatch}
          onSwitchToVisual={() => setViewMode('visual')}
        />
      )}
    </div>
  );
}
