var User = require('../models/user.js');
var Task = require('../models/task.js');
var helpers = require('./helpers.js');
var sendData = helpers.sendData;
var sendError = helpers.sendError;
var isValidObjectId = helpers.isValidObjectId;
var parseJSONParam = helpers.parseJSONParam;
var parseListParams = helpers.parseListParams;
var isPlainObject = helpers.isPlainObject;
var isBadQueryError = helpers.isBadQueryError;

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userIdRoute = router.route('/users/:id');

    // GET /users - list users (where/sort/select/skip/limit/count)
    usersRoute.get(async function (req, res) {
        try {
            var params = parseListParams(req.query, undefined); // no default limit for users
            if (!params.ok) {
                return sendError(res, 400, params.message);
            }

            if (params.count) {
                var total = await User.countDocuments(params.where);
                return sendData(res, 200, 'OK', total);
            }

            // Mongo treats limit(0) as "no limit", but the API contract is "return 0 results"
            if (params.limit === 0) {
                return sendData(res, 200, 'OK', []);
            }

            var query = User.find(params.where);
            if (params.sort !== undefined) {
                query = query.sort(params.sort);
            }
            if (params.select !== undefined) {
                query = query.select(params.select);
            }
            query = query.skip(params.skip);
            if (params.limit !== undefined) {
                query = query.limit(params.limit);
            }

            var users = await query.exec();
            return sendData(res, 200, 'OK', users);
        } catch (err) {
            if (isBadQueryError(err)) {
                return sendError(res, 400, 'Invalid "where", "sort" or "select" query parameter.');
            }
            return sendError(res, 500, 'An unexpected error occurred while fetching users.');
        }
    });

    // POST /users - create a new user
    usersRoute.post(async function (req, res) {
        try {
            var body = req.body || {};

            // Required fields
            if (typeof body.name !== 'string' || body.name.trim() === '') {
                return sendError(res, 400, 'A user requires a "name" (non-empty string).');
            }
            if (typeof body.email !== 'string' || body.email.trim() === '') {
                return sendError(res, 400, 'A user requires an "email" (non-empty string).');
            }

            // Email uniqueness
            var existing = await User.findOne({ email: body.email });
            if (existing) {
                return sendError(res, 400, 'A user with email "' + body.email + '" already exists.');
            }

            // pendingTasks: optional array of task ids
            var pendingTasks = body.pendingTasks !== undefined ? body.pendingTasks : [];
            if (!Array.isArray(pendingTasks) || !pendingTasks.every(function (t) { return typeof t === 'string'; })) {
                return sendError(res, 400, '"pendingTasks" must be an array of task id strings.');
            }
            for (var i = 0; i < pendingTasks.length; i++) {
                if (!isValidObjectId(pendingTasks[i])) {
                    return sendError(res, 400, '"pendingTasks" contains an invalid task id: "' + pendingTasks[i] + '".');
                }
            }

            // Verify every pending task exists and is not already completed
            var tasks = [];
            for (var j = 0; j < pendingTasks.length; j++) {
                var task = await Task.findById(pendingTasks[j]);
                if (!task) {
                    return sendError(res, 404, 'Task "' + pendingTasks[j] + '" in "pendingTasks" does not exist.');
                }
                if (task.completed) {
                    return sendError(res, 400, 'Task "' + pendingTasks[j] + '" in "pendingTasks" is already completed.');
                }
                tasks.push(task);
            }

            // All validation passed - create the user
            var user = new User({
                name: body.name,
                email: body.email,
                pendingTasks: pendingTasks
            });
            await user.save();

            // Keep two-way references consistent: assign each pending task to this user,
            // moving it off any other user that currently holds it.
            for (var k = 0; k < tasks.length; k++) {
                var t = tasks[k];
                if (t.assignedUser && t.assignedUser !== String(user._id)) {
                    await User.updateOne({ _id: t.assignedUser }, { $pull: { pendingTasks: String(t._id) } });
                }
                t.assignedUser = String(user._id);
                t.assignedUserName = user.name;
                await t.save();
            }

            return sendData(res, 201, 'User created.', user);
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while creating the user.');
        }
    });

    // GET /users/:id - fetch a single user by id
    userIdRoute.get(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            var selectParsed = parseJSONParam(req.query.select);
            if (!selectParsed.ok || (selectParsed.value !== undefined && !isPlainObject(selectParsed.value))) {
                return sendError(res, 400, '"select" must be a valid JSON object.');
            }

            var query = User.findById(id);
            if (selectParsed.value !== undefined) {
                query = query.select(selectParsed.value);
            }

            var user = await query.exec();
            if (!user) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            return sendData(res, 200, 'OK', user);
        } catch (err) {
            if (isBadQueryError(err)) {
                return sendError(res, 400, 'Invalid "select" query parameter.');
            }
            return sendError(res, 500, 'An unexpected error occurred while fetching the user.');
        }
    });

    // PUT /users/:id - replace a user, keeping Task <-> User references consistent
    userIdRoute.put(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            var user = await User.findById(id);
            if (!user) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            var body = req.body || {};

            // Required fields
            if (typeof body.name !== 'string' || body.name.trim() === '') {
                return sendError(res, 400, 'A user requires a "name" (non-empty string).');
            }
            if (typeof body.email !== 'string' || body.email.trim() === '') {
                return sendError(res, 400, 'A user requires an "email" (non-empty string).');
            }

            // Email uniqueness (excluding this user)
            var existing = await User.findOne({ email: body.email, _id: { $ne: user._id } });
            if (existing) {
                return sendError(res, 400, 'A user with email "' + body.email + '" already exists.');
            }

            // pendingTasks: optional array of task ids (missing means empty list)
            var newPending = body.pendingTasks !== undefined ? body.pendingTasks : [];
            if (!Array.isArray(newPending) || !newPending.every(function (t) { return typeof t === 'string'; })) {
                return sendError(res, 400, '"pendingTasks" must be an array of task id strings.');
            }
            for (var i = 0; i < newPending.length; i++) {
                if (!isValidObjectId(newPending[i])) {
                    return sendError(res, 400, '"pendingTasks" contains an invalid task id: "' + newPending[i] + '".');
                }
            }

            // Verify every pending task exists and is not already completed
            var newTasksById = {};
            for (var j = 0; j < newPending.length; j++) {
                var nTask = await Task.findById(newPending[j]);
                if (!nTask) {
                    return sendError(res, 404, 'Task "' + newPending[j] + '" in "pendingTasks" does not exist.');
                }
                if (nTask.completed) {
                    return sendError(res, 400, 'Task "' + newPending[j] + '" in "pendingTasks" is already completed.');
                }
                newTasksById[newPending[j]] = nTask;
            }

            // All validation passed - diff old vs new pendingTasks and perform the writes
            var oldPending = user.pendingTasks || [];
            var newIdSet = {};
            newPending.forEach(function (t) { newIdSet[t] = true; });
            var oldIdSet = {};
            oldPending.forEach(function (t) { oldIdSet[t] = true; });

            var toUnassign = oldPending.filter(function (t) { return !newIdSet[t]; });
            var toAssign = newPending.filter(function (t) { return !oldIdSet[t]; });

            var userIdStr = String(user._id);
            var newName = body.name;

            // 1. Unassign tasks dropped from pendingTasks
            for (var u = 0; u < toUnassign.length; u++) {
                await Task.updateOne({ _id: toUnassign[u] }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } });
            }

            // 2. Assign newly-added tasks to this user, moving them off any other user
            for (var a = 0; a < toAssign.length; a++) {
                var taskId = toAssign[a];
                var taskDoc = newTasksById[taskId];
                if (taskDoc.assignedUser && taskDoc.assignedUser !== userIdStr) {
                    await User.updateOne({ _id: taskDoc.assignedUser }, { $pull: { pendingTasks: taskId } });
                }
                await Task.updateOne({ _id: taskId }, { $set: { assignedUser: userIdStr, assignedUserName: newName } });
            }

            // 3. Tasks that stay assigned to this user (pending or completed) pick up a renamed user
            await Task.updateMany(
                { assignedUser: userIdStr, _id: { $nin: toUnassign } },
                { $set: { assignedUserName: newName } }
            );

            // 4. Replace the user document itself (dateCreated is immutable and untouched)
            user.name = newName;
            user.email = body.email;
            user.pendingTasks = newPending;
            await user.save();

            return sendData(res, 200, 'User updated.', user);
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while updating the user.');
        }
    });

    // DELETE /users/:id - delete a user, unassigning all of their tasks
    userIdRoute.delete(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            var user = await User.findById(id);
            if (!user) {
                return sendError(res, 404, 'No user exists with id "' + id + '".');
            }

            // Unassign every task held by this user, pending or completed
            await Task.updateMany(
                { assignedUser: String(user._id) },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
            );

            await User.deleteOne({ _id: user._id });

            return sendData(res, 200, 'User deleted.', user);
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while deleting the user.');
        }
    });

    return router;
};
