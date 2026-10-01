-- Live updates: every committed change to an order or a rider's position is sent on the
-- "koboride_live" channel. The API listens once and forwards each event to the people it concerns.

CREATE OR REPLACE FUNCTION koboride_order_payload(o "Order", prev_status text, prev_rider text, loc_only boolean, deleted boolean)
RETURNS text AS $$
  SELECT json_build_object(
    't', 'order',
    'id', o.id,
    'status', o.status,
    'prevStatus', prev_status,
    'customerId', o."customerId",
    'riderId', o."riderId",
    'prevRiderId', prev_rider,
    'merchantId', o."merchantId",
    'zoneSlug', o."zoneSlug",
    'locOnly', loc_only,
    'deleted', deleted
  )::text
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION koboride_notify_order() RETURNS trigger AS $$
DECLARE
  loc_cols text[] := ARRAY['updatedAt', 'riderLat', 'riderLng', 'riderLocationAt'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('koboride_live', koboride_order_payload(NEW, NULL, NULL, false, false));
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('koboride_live', koboride_order_payload(OLD, OLD.status::text, OLD."riderId", false, true));
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'updatedAt') = (to_jsonb(OLD) - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('koboride_live', koboride_order_payload(
    NEW,
    OLD.status::text,
    OLD."riderId",
    (to_jsonb(NEW) - loc_cols) = (to_jsonb(OLD) - loc_cols),
    false
  ));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_live ON "Order";
CREATE TRIGGER order_live
  AFTER INSERT OR UPDATE OR DELETE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION koboride_notify_order();

-- For changes that don't touch the order row, such as a scheduled order becoming available.
CREATE OR REPLACE FUNCTION koboride_order_touched(order_id text) RETURNS void AS $$
  SELECT pg_notify('koboride_live', koboride_order_payload(o, o.status::text, o."riderId", false, false))
  FROM "Order" o
  WHERE o.id = order_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION koboride_notify_rider() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('koboride_live', json_build_object('t', 'rider', 'id', NEW.id)::text);
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rider_live ON "Rider";
CREATE TRIGGER rider_live
  AFTER UPDATE OF "lastLat", "lastLng", "lastLocationAt", "availability" ON "Rider"
  FOR EACH ROW
  WHEN (OLD."lastLocationAt" IS DISTINCT FROM NEW."lastLocationAt" OR OLD."availability" IS DISTINCT FROM NEW."availability")
  EXECUTE FUNCTION koboride_notify_rider();
