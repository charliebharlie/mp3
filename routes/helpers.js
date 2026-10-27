var mongoose = require('mongoose');

// Standard {message, data} success response
function sendData(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

// Standard {message, data: {}} error response (never leaks Mongoose/MongoDB internals)
function sendError(res, status, message) {
    res.status(status).json({ message: message, data: {} });
}

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

// Parse a JSON query-string parameter (where/sort/select/...). Returns { ok, value }.
function parseJSONParam(raw) {
    if (raw === undefined) {
        return { ok: true, value: undefined };
    }
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
        return { ok: false, value: undefined };
    }
}

// A parsed JSON value is "plain object shaped" if it can be handed to Mongoose
// as a filter/sort/projection document (not an array, not a bare primitive).
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Catches every error Mongoose/MongoDB can throw while building or running a
// query from caller-supplied where/sort/select/skip/limit values (bad ObjectId
// in a filter, "sort" not a number, mixed inclusion/exclusion projection, ...).
// Anything shaped like that is the caller's fault, i.e. a 400, never a 500.
function isBadQueryError(err) {
    return err instanceof TypeError ||
        err.name === 'CastError' ||
        err.name === 'ObjectParameterError' ||
        err.name === 'StrictModeError' ||
        err.name === 'StrictPopulateError' ||
        err.name === 'MongoServerError';
}

// Parse the where/sort/select/skip/limit/count query-string params shared by the
// GET /users and GET /tasks collection endpoints. Returns { ok: false, message }
// on the first invalid value, otherwise { ok: true, where, sort, select, skip, limit, count }.
function parseListParams(query, defaultLimit) {
    var where = parseJSONParam(query.where);
    if (!where.ok || (where.value !== undefined && !isPlainObject(where.value))) {
        return { ok: false, message: '"where" must be a valid JSON object.' };
    }

    var sort = parseJSONParam(query.sort);
    if (!sort.ok || (sort.value !== undefined && !isPlainObject(sort.value))) {
        return { ok: false, message: '"sort" must be a valid JSON object.' };
    }

    var select = parseJSONParam(query.select);
    if (!select.ok || (select.value !== undefined && !isPlainObject(select.value))) {
        return { ok: false, message: '"select" must be a valid JSON object.' };
    }

    var skip = 0;
    if (query.skip !== undefined) {
        skip = Number(query.skip);
        if (!Number.isInteger(skip) || skip < 0) {
            return { ok: false, message: '"skip" must be a non-negative integer.' };
        }
    }

    var limit = defaultLimit;
    if (query.limit !== undefined) {
        limit = Number(query.limit);
        if (!Number.isInteger(limit) || limit < 0) {
            return { ok: false, message: '"limit" must be a non-negative integer.' };
        }
    }

    var count = query.count === 'true';

    return {
        ok: true,
        where: where.value !== undefined ? where.value : {},
        sort: sort.value,
        select: select.value,
        skip: skip,
        limit: limit,
        count: count
    };
}

module.exports = {
    sendData: sendData,
    sendError: sendError,
    isValidObjectId: isValidObjectId,
    isPlainObject: isPlainObject,
    isBadQueryError: isBadQueryError,
    parseJSONParam: parseJSONParam,
    parseListParams: parseListParams
};
