var Task = require('../models/task.js');
var User = require('../models/user.js');
var helpers = require('./helpers.js');
var sendData = helpers.sendData;
var sendError = helpers.sendError;
var isValidObjectId = helpers.isValidObjectId;
var parseJSONParam = helpers.parseJSONParam;
var parseListParams = helpers.parseListParams;
var isPlainObject = helpers.isPlainObject;
var isBadQueryError = helpers.isBadQueryError;

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskIdRoute = router.route('/tasks/:id');

    // GET /tasks - list tasks (where/sort/select/skip/limit/count)
    tasksRoute.get(async function (req, res) {
        try {
            var params = parseListParams(req.query, 100); // default limit of 100 for tasks
            if (!params.ok) {
                return sendError(res, 400, params.message);
            }

            if (params.count) {
                var total = await Task.countDocuments(params.where);
                return sendData(res, 200, 'OK', total);
            }

            // Mongo treats limit(0) as "no limit", but the API contract is "return 0 results"
            if (params.limit === 0) {
                return sendData(res, 200, 'OK', []);
            }

            var query = Task.find(params.where);
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

            var tasks = await query.exec();
            return sendData(res, 200, 'OK', tasks);
        } catch (err) {
            if (isBadQueryError(err)) {
                return sendError(res, 400, 'Invalid "where", "sort" or "select" query parameter.');
            }
            return sendError(res, 500, 'An unexpected error occurred while fetching tasks.');
        }
    });

    // POST /tasks - create a new task
    tasksRoute.post(async function (req, res) {
        try {
            var body = req.body || {};

            // Required fields
            if (typeof body.name !== 'string' || body.name.trim() === '') {
                return sendError(res, 400, 'A task requires a "name" (non-empty string).');
            }
            if (body.deadline === undefined || body.deadline === null || isNaN(new Date(body.deadline).getTime())) {
                return sendError(res, 400, 'A task requires a valid "deadline" date.');
            }
            if (body.completed !== undefined && typeof body.completed !== 'boolean') {
                return sendError(res, 400, '"completed" must be a boolean.');
            }
            if (body.description !== undefined && typeof body.description !== 'string') {
                return sendError(res, 400, '"description" must be a string.');
            }

            var completed = body.completed !== undefined ? body.completed : false;
            var assignedUser = body.assignedUser !== undefined ? body.assignedUser : '';
            if (typeof assignedUser !== 'string') {
                return sendError(res, 400, '"assignedUser" must be a string.');
            }

            var user = null;
            if (assignedUser !== '') {
                if (!isValidObjectId(assignedUser)) {
                    return sendError(res, 400, '"assignedUser" is not a valid user id.');
                }
                user = await User.findById(assignedUser);
                if (!user) {
                    return sendError(res, 404, 'No user exists with id "' + assignedUser + '" for "assignedUser".');
                }
            }

            var assignedUserName;
            if (assignedUser === '') {
                assignedUserName = 'unassigned';
            } else if (body.assignedUserName !== undefined) {
                if (typeof body.assignedUserName !== 'string' || body.assignedUserName !== user.name) {
                    return sendError(res, 400, '"assignedUserName" does not match the name of "assignedUser".');
                }
                assignedUserName = body.assignedUserName;
            } else {
                assignedUserName = user.name;
            }

            // All validation passed - create the task
            var task = new Task({
                name: body.name,
                description: body.description !== undefined ? body.description : '',
                deadline: body.deadline,
                completed: completed,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName
            });
            await task.save();

            // Keep two-way reference consistent: pending tasks assigned to a user show in pendingTasks
            if (user && !completed) {
                await User.updateOne({ _id: user._id }, { $addToSet: { pendingTasks: String(task._id) } });
            }

            return sendData(res, 201, 'Task created.', task);
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while creating the task.');
        }
    });

    // GET /tasks/:id - fetch a single task by id
    taskIdRoute.get(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            var selectParsed = parseJSONParam(req.query.select);
            if (!selectParsed.ok || (selectParsed.value !== undefined && !isPlainObject(selectParsed.value))) {
                return sendError(res, 400, '"select" must be a valid JSON object.');
            }

            var query = Task.findById(id);
            if (selectParsed.value !== undefined) {
                query = query.select(selectParsed.value);
            }

            var task = await query.exec();
            if (!task) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            return sendData(res, 200, 'OK', task);
        } catch (err) {
            if (isBadQueryError(err)) {
                return sendError(res, 400, 'Invalid "select" query parameter.');
            }
            return sendError(res, 500, 'An unexpected error occurred while fetching the task.');
        }
    });

    // PUT /tasks/:id - replace a task, keeping Task <-> User references consistent
    taskIdRoute.put(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            var task = await Task.findById(id);
            if (!task) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            var body = req.body || {};

            // Required fields
            if (typeof body.name !== 'string' || body.name.trim() === '') {
                return sendError(res, 400, 'A task requires a "name" (non-empty string).');
            }
            if (body.deadline === undefined || body.deadline === null || isNaN(new Date(body.deadline).getTime())) {
                return sendError(res, 400, 'A task requires a valid "deadline" date.');
            }
            if (body.completed !== undefined && typeof body.completed !== 'boolean') {
                return sendError(res, 400, '"completed" must be a boolean.');
            }
            if (body.description !== undefined && typeof body.description !== 'string') {
                return sendError(res, 400, '"description" must be a string.');
            }

            var newCompleted = body.completed !== undefined ? body.completed : false;
            var newAssignedUser = body.assignedUser !== undefined ? body.assignedUser : '';
            if (typeof newAssignedUser !== 'string') {
                return sendError(res, 400, '"assignedUser" must be a string.');
            }

            var newUser = null;
            if (newAssignedUser !== '') {
                if (!isValidObjectId(newAssignedUser)) {
                    return sendError(res, 400, '"assignedUser" is not a valid user id.');
                }
                newUser = await User.findById(newAssignedUser);
                if (!newUser) {
                    return sendError(res, 404, 'No user exists with id "' + newAssignedUser + '" for "assignedUser".');
                }
            }

            var newAssignedUserName;
            if (newAssignedUser === '') {
                newAssignedUserName = 'unassigned';
            } else if (body.assignedUserName !== undefined) {
                if (typeof body.assignedUserName !== 'string' || body.assignedUserName !== newUser.name) {
                    return sendError(res, 400, '"assignedUserName" does not match the name of "assignedUser".');
                }
                newAssignedUserName = body.assignedUserName;
            } else {
                newAssignedUserName = newUser.name;
            }

            // All validation passed - diff old vs new assignment and perform the writes
            var oldAssignedUser = task.assignedUser || '';
            var taskIdStr = String(task._id);

            // 1. If the task moved off its previous user, drop it from that user's pendingTasks
            if (oldAssignedUser !== '' && oldAssignedUser !== newAssignedUser) {
                await User.updateOne({ _id: oldAssignedUser }, { $pull: { pendingTasks: taskIdStr } });
            }

            // 2. Reconcile the (possibly new) assigned user's pendingTasks with the new completed state
            if (newAssignedUser !== '') {
                if (newCompleted) {
                    await User.updateOne({ _id: newAssignedUser }, { $pull: { pendingTasks: taskIdStr } });
                } else {
                    await User.updateOne({ _id: newAssignedUser }, { $addToSet: { pendingTasks: taskIdStr } });
                }
            }

            // 3. Replace the task document itself (dateCreated is immutable and untouched)
            task.name = body.name;
            task.description = body.description !== undefined ? body.description : '';
            task.deadline = body.deadline;
            task.completed = newCompleted;
            task.assignedUser = newAssignedUser;
            task.assignedUserName = newAssignedUserName;
            await task.save();

            return sendData(res, 200, 'Task updated.', task);
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while updating the task.');
        }
    });

    // DELETE /tasks/:id - delete a task, pulling it out of its assigned user's pendingTasks
    taskIdRoute.delete(async function (req, res) {
        try {
            var id = req.params.id;
            if (!isValidObjectId(id)) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            var task = await Task.findById(id);
            if (!task) {
                return sendError(res, 404, 'No task exists with id "' + id + '".');
            }

            if (task.assignedUser) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } });
            }

            await Task.deleteOne({ _id: task._id });

            return res.status(204).end();
        } catch (err) {
            return sendError(res, 500, 'An unexpected error occurred while deleting the task.');
        }
    });

    return router;
};
