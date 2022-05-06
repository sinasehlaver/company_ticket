from django.db import models

# Create your models here.


class Hall(models.Model):
	name = models.CharField(max_length=200)
	seats = models.JSONField()
	seatPlan = models.JSONField()


class Event(models.Model):
	name = models.CharField(max_length=200)
	hall = models.ForeignKey(Hall, on_delete=models.CASCADE)


class Ticket(models.Model):
	row = models.CharField(max_length=10)
	num = models.CharField(max_length=10)
	date = models.DateTimeField()
	event = models.ForeignKey(Event, on_delete=models.CASCADE)
	price = models.PositiveSmallIntegerField()
	status = models.PositiveSmallIntegerField(default=0)
	category = models.PositiveSmallIntegerField()
	lastModifiedBy = models.CharField(max_length=200)
	lastModified = models.DateTimeField()

