var Mongo = Package.mongo.Mongo;

var globalContext = this;

Mongo.Collection.prototype.doJoin = function (collectionObject, collectionName, collectionNameField, foreignKey, containerField, fieldList) {
	this._joins = this._joins || [];

	this._joins.push({
		collectionObject: collectionObject,
		collectionName: collectionName,
		collectionNameField: collectionNameField,
		foreignKey: foreignKey,
		containerField: containerField,
		fieldList: fieldList
	});

	var __original = {
		find: Mongo.Collection.prototype.find,
		findOne: Mongo.Collection.prototype.findOne
	};

	this.transformFind = function (originalFind, selector, options) {
		var self = this;
		selector = selector || {};
		options = options || {};

		var originalTransform = options.transform || null;

		self._reactiveJoin = options.reactiveJoin || false;
		// Don't want to send this on to find, just in case.
		delete options.reactiveJoin;

		options.transform = function (doc) {
			_.each(self._joins, function (join) {
				var opt = {};
				if (join.fieldList && join.fieldList.length) {
					opt.fields = {};
					_.each(join.fieldList, function (field) {
						opt.fields[field] = 1;
					});
				}

				var coll = null;
				if (join.collectionObject)
					coll = join.collectionObject;
				else if (join.collectionName)
					coll = globalContext[join.collectionName];
				else if (join.collectionNameField)
					coll = globalContext[doc[join.collectionNameField]];

				if (coll) {
					var container = join.containerField || coll._name + "_joined";
					if (self._reactiveJoin) {
						opt.limit = 1;
						var cursor = __original.find.call(coll, {_id: doc[join.foreignKey]}, opt);
						cursor.observe({
							addedAt: function (newDoc, index, before) {
								doc[container] = newDoc;
							},
							changedAt: function (newDoc, index, before) {
								doc[container] = newDoc;
							},
							removedAt: function (newDoc, index, before) {
								doc[container] = {};
							}
						});
					} else {
						doc[container] = __original.findOne.call(coll, {_id: doc[join.foreignKey]}, opt);
					}
				}
			});
			if (originalTransform)
				return originalTransform(doc);
			else
				return doc;
		};
		return originalFind.call(this, selector, options);
	};

	this.findOne = function (selector, options) {
		return this.transformFind(__original.findOne, selector, options);
	};

	this.find = function (selector, options) {
		return this.transformFind(__original.find, selector, options);
	};

};

// collection argument can be collection object or collection name
Mongo.Collection.prototype.join = function (collection, foreignKey, containerField, fieldList) {
	var collectionObject = null;
	var collectionName = "";

	if (_.isString(collection)) {
		collectionName = collection;
	} else {
		collectionObject = collection;
	}

	this.doJoin(collectionObject, collectionName, "", foreignKey, containerField, fieldList);
};

Mongo.Collection.prototype.genericJoin = function (collectionNameField, foreignKey, containerField) {
	this.doJoin(null, "", collectionNameField, foreignKey, containerField, []);
};

Mongo.Collection.prototype.publishJoinedCursors = function (cursor) {
	var cursors = [];
	cursors.push(cursor);

	_.each(this._joins, function (join) {

		if (join.collectionObject || join.collectionName) {
			var coll = null;

			if (join.collectionObject) {
				coll = join.collectionObject;
			} else {
				coll = globalContext[join.collectionName];
			}

			if (coll) {
				var ids = cursor.map(function (doc) {
					return doc[join.foreignKey];
				});
				var cur = coll.find({_id: {$in: ids}});
				cursors.push(cur);
			}

		} else if (join.collectionNameField) {
			var data = cursor.map(function (doc) {
				var res = {};
				res[join.collectionNameField] = doc[join.collectionNameField];
				res[join.foreignKey] = doc[join.foreignKey];
				return res;
			});

			var collectionNames = _.uniq(_.map(data, function (doc) {
				return doc[join.collectionNameField];
			}));
			_.each(collectionNames, function (collectionName) {
				var coll = globalContext[collectionName];
				if (coll) {
					var ids = _.map(_.filter(data, function (doc) {
						return doc[join.collectionNameField] === collectionName;
					}), function (el) {
						return el[join.foreignKey];
					});
					var cur = coll.find({_id: {$in: ids}});
					cursors.push(cur);
				}
			});
		}
	});

	return cursors;
};
